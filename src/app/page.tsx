'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Loader2, FileUp, CheckCircle2, AlertCircle, Save } from 'lucide-react';
import { XMEMLParser } from '../lib/parser/xmeml-parser';
import { CSVExporter } from '../lib/parser/csv-exporter';
import { EDLExporter } from '../lib/parser/edl-exporter';

// Tauri APIs (Conditional import for browser compatibility during dev)
let openDialog: any;
let writeTextFile: any;

if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
  import('@tauri-apps/plugin-dialog').then(mod => { openDialog = mod.open; });
  import('@tauri-apps/plugin-fs').then(mod => { writeTextFile = mod.writeTextFile; });
}

const EXPORT_DEFAULTS = {
  csvShotList: true,
  csvTransforms: true,
  csvSpeedChanges: true,
  csvEffects: true,
  edlTransforms: true,
  edlSpeed: true,
  edlCrops: true,
  edlEffects: true,
  edlCombined: true,
};

export default function DesktopParser() {
  const [status, setStatus] = useState<'idle' | 'parsing' | 'saving' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);
  const [exportOptions, setExportOptions] = useState<typeof EXPORT_DEFAULTS>(EXPORT_DEFAULTS);
  const [isTauriDragging, setIsTauriDragging] = useState(false);

  const toggleExport = (key: keyof typeof EXPORT_DEFAULTS) =>
    setExportOptions(prev => ({ ...prev, [key]: !prev[key] }));

  // Keep a stable ref to startParsing so the Tauri event listener can call it
  // without needing to re-subscribe on every render.
  const startParsingRef = useRef<(xml: string, name: string) => void>(null as any);

  // Tauri native drag-drop — HTML5 drag events don't fire in WebKit webviews
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) return;

    let unlisten: (() => void) | undefined;
    let unlistenEnter: (() => void) | undefined;
    let unlistenLeave: (() => void) | undefined;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');

      unlistenEnter = await listen('tauri://drag-enter', () => setIsTauriDragging(true));
      unlistenLeave = await listen('tauri://drag-leave', () => setIsTauriDragging(false));

      unlisten = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
        setIsTauriDragging(false);
        const paths = event.payload.paths;
        const filePath = paths?.find(p => p.toLowerCase().endsWith('.xml'));
        if (!filePath) return;
        const fileName = filePath.split('/').pop() ?? filePath;
        readTextFile(filePath).then(content => {
          startParsingRef.current(content, fileName);
        });
      });
    })();

    return () => { unlisten?.(); unlistenEnter?.(); unlistenLeave?.(); };
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const xmlContent = reader.result as string;
      startParsing(xmlContent, file.name);
    };
    reader.readAsText(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/xml': ['.xml'], 'application/xml': ['.xml'] },
    multiple: false
  });

  const startParsing = (xmlContent: string, fileName: string) => {
    setStatus('parsing');
    setError(null);
    setStatusMessage('Analysing XMEML data...');

    setTimeout(() => {
      try {
        const parser = new XMEMLParser();
        const result = parser.parse(xmlContent);

        setStatusMessage('Generating reports...');

        const frameRate = result.metadata.frameRate;
        const timelineResolution = result.metadata.resolution;
        const baseName = fileName.replace(/\.xml$/i, '');

        const csvExporter = new CSVExporter();
        const csvs = {
          shotList:    csvExporter.generateMasterShotListCSV(result.clips),
          transforms:  csvExporter.generateTransformsCSV(result.clips),
          speedChanges: csvExporter.generateSpeedChangesCSV(result.clips),
          effects:     csvExporter.generateEffectsInventoryCSV(result.clips),
        };

        const edlExporter = new EDLExporter();
        const edls = {
          transforms: edlExporter.generateTransformsEDL(result.clips, baseName, frameRate),
          speed:      edlExporter.generateSpeedChangesEDL(result.clips, baseName, frameRate),
          crops:      edlExporter.generateCropsEDL(result.clips, baseName, frameRate),
          effects:    edlExporter.generateEffectsEDL(result.clips, baseName, frameRate),
          combined:   edlExporter.generateCombinedEDL(result.clips, baseName, frameRate),
        };

        const effectsCount = result.clips.filter((c: any) =>
          c.effects.some((e: any) => e.effectId !== 'basic' && e.effectId !== 'timeremap' &&
            e.name !== 'Basic Motion' && e.name !== 'Time Remap')
        ).length;

        setResults({
          csvs,
          edls,
          metadata: result.metadata,
          fileName,
          baseName,
          counts: {
            total:      result.clips.length,
            transforms: result.clips.filter((c: any) =>
              c.hasKeyframes || (c.scale && c.scale !== 100) ||
              (c.rotation && c.rotation !== 0)
            ).length,
            speed:   result.clips.filter((c: any) => c.speed && c.speed !== 100).length,
            effects: effectsCount,
          },
        });
        setStatus('idle');
        setStatusMessage('Parsing complete!');
      } catch (err: any) {
        setError(err.message || 'Unknown parsing error');
        setStatus('error');
      }
    }, 50);
  };
  startParsingRef.current = startParsing;

  const handleSaveToDisk = async () => {
    if (!results) return;

    setStatus('saving');
    setStatusMessage('Choosing export location...');

    try {
      if (!openDialog || !writeTextFile) {
        setError('Save is only available in the desktop app.');
        setStatus('error');
        return;
      }

      const exportDir = await openDialog({
        directory: true,
        multiple: false,
        title: 'Choose folder to save reports',
      });

      if (!exportDir) {
        setStatus('idle');
        return;
      }

      const b = results.baseName;
      const o = exportOptions;

      setStatusMessage('Writing CSV reports...');
      if (o.csvShotList)    await writeTextFile(`${exportDir}/${b}_master_shot_list.csv`,  results.csvs.shotList);
      if (o.csvTransforms)  await writeTextFile(`${exportDir}/${b}_transforms.csv`,        results.csvs.transforms);
      if (o.csvSpeedChanges) await writeTextFile(`${exportDir}/${b}_speed_changes.csv`,    results.csvs.speedChanges);
      if (o.csvEffects)     await writeTextFile(`${exportDir}/${b}_effects_inventory.csv`, results.csvs.effects);

      setStatusMessage('Writing Resolve EDL markers...');
      if (o.edlTransforms) await writeTextFile(`${exportDir}/${b}_markers_transforms.edl`, results.edls.transforms);
      if (o.edlSpeed)      await writeTextFile(`${exportDir}/${b}_markers_speed.edl`,      results.edls.speed);
      if (o.edlCrops)      await writeTextFile(`${exportDir}/${b}_markers_crops.edl`,      results.edls.crops);
      if (o.edlEffects)    await writeTextFile(`${exportDir}/${b}_markers_effects.edl`,    results.edls.effects);
      if (o.edlCombined)   await writeTextFile(`${exportDir}/${b}_markers_combined.edl`,   results.edls.combined);

      setStatus('success');
      setStatusMessage('All reports saved!');
    } catch (err: any) {
      setError('Failed to save files: ' + err.message);
      setStatus('error');
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-zinc-950 text-zinc-100 font-sans">
      <div className="w-full max-w-2xl space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-white">XML Parser</h1>
          <p className="text-zinc-400">Standalone tool for professional turnovers</p>
        </header>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 shadow-2xl">
          {status === 'idle' || status === 'error' ? (
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all
                ${isDragActive || isTauriDragging ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/50'}`}
            >
              <input {...getInputProps()} />
              <FileUp className="mx-auto h-12 w-12 text-zinc-500 mb-4" />
              <p className="text-lg font-medium">Select XML file</p>
              <p className="text-sm text-zinc-500 mt-2">Export from Premiere Pro via File → Export → Final Cut Pro XML</p>
            </div>
          ) : (
            <div className="py-12 text-center space-y-6">
              <div className="flex justify-center">
                {status === 'parsing' || status === 'saving' ? (
                  <Loader2 className="h-16 w-16 text-blue-500 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-16 w-16 text-green-500" />
                )}
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold capitalize">{status}...</h2>
                <p className="text-zinc-400">{statusMessage}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-red-950/30 border border-red-900/50 rounded-lg flex items-start gap-3 text-red-400">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {results && status !== 'parsing' && status !== 'saving' && (
            <div className="mt-8 p-6 bg-zinc-800/50 rounded-lg border border-zinc-700 space-y-6">

              {/* File name — prominent, single occurrence */}
              <div>
                <h3 className="text-xl font-semibold text-white break-all leading-snug">{results.fileName}</h3>
                {results.metadata && (
                  <div className="text-xs text-zinc-400 flex gap-3 font-mono mt-2">
                    <span>{results.metadata.frameRate} fps</span>
                    {results.metadata.resolution && (
                      <span>{results.metadata.resolution.width}×{results.metadata.resolution.height}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Stats grid — 2×2 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 text-center">
                  <div className="text-2xl font-bold text-white">{results.counts.total}</div>
                  <div className="text-xs text-zinc-400 uppercase mt-1">Total Clips</div>
                </div>
                <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 text-center">
                  <div className="text-2xl font-bold text-red-400">{results.counts.transforms}</div>
                  <div className="text-xs text-zinc-400 uppercase mt-1">Transforms</div>
                </div>
                <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 text-center">
                  <div className="text-2xl font-bold text-blue-400">{results.counts.speed}</div>
                  <div className="text-xs text-zinc-400 uppercase mt-1">Speed Changes</div>
                </div>
                <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 text-center">
                  <div className="text-2xl font-bold text-green-400">{results.counts.effects}</div>
                  <div className="text-xs text-zinc-400 uppercase mt-1">Effects</div>
                </div>
              </div>

              {/* Export toggles */}
              <div className="space-y-3">
                <p className="text-xs text-zinc-400 font-medium uppercase tracking-widest">Export</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  {/* CSV column */}
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">CSV Reports</p>
                    {([
                      { key: 'csvShotList',     label: 'Master Shot List' },
                      { key: 'csvTransforms',   label: 'Transforms' },
                      { key: 'csvSpeedChanges', label: 'Speed Changes' },
                      { key: 'csvEffects',      label: 'Effects Inventory' },
                    ] as const).map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={exportOptions[key]}
                          onChange={() => toggleExport(key)}
                          className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                        />
                        <span className="text-sm text-zinc-300">{label}</span>
                      </label>
                    ))}
                  </div>
                  {/* EDL column */}
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Resolve EDL Markers</p>
                    {([
                      { key: 'edlTransforms', label: 'Transforms', dot: 'text-red-400' },
                      { key: 'edlSpeed',      label: 'Speed',      dot: 'text-blue-400' },
                      { key: 'edlCrops',      label: 'Crops',      dot: 'text-green-400' },
                      { key: 'edlEffects',    label: 'Effects',    dot: 'text-purple-400' },
                      { key: 'edlCombined',   label: 'Combined',   dot: 'text-fuchsia-400' },
                    ] as const).map(({ key, label, dot }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={exportOptions[key]}
                          onChange={() => toggleExport(key)}
                          className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                        />
                        <span className={`text-xs ${dot}`}>■</span>
                        <span className="text-sm text-zinc-300">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {status !== 'success' && (
                <button
                  onClick={handleSaveToDisk}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-900/20"
                >
                  <Save className="h-5 w-5" />
                  Save to Folder
                </button>
              )}

              {status === 'success' && (
                <button
                  onClick={() => { setStatus('idle'); setResults(null); setError(null); setExportOptions(EXPORT_DEFAULTS); }}
                  className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  Process Another File
                </button>
              )}
            </div>
          )}
        </div>

        <footer className="text-center text-zinc-600 text-sm">
          <p>100% Private &amp; Local • No data ever leaves your Mac</p>
        </footer>
      </div>
    </main>
  );
}
