import { XMEMLParser } from './xmeml-parser';
import { CSVExporter } from './csv-exporter';

// Use a self-executing function to avoid issues with global 'self' types in some environments
(function() {
  const ctx: Worker = self as any;

  ctx.onmessage = async (e: MessageEvent) => {
    const { xmlContent } = e.data;
    
    try {
      ctx.postMessage({ type: 'STATUS', status: 'Analyzing XMEML data...' });
      
      const parser = new XMEMLParser();
      const result = parser.parse(xmlContent);
      
      ctx.postMessage({ type: 'STATUS', status: 'Generating CSV reports...' });
      
      const exporter = new CSVExporter();
      const csvs = {
        shotList: exporter.generateShotListCSV(result.clips),
        transforms: exporter.generateTransformsCSV(result.clips),
        speedChanges: exporter.generateSpeedChangesCSV(result.clips),
        effects: exporter.generateEffectsInventoryCSV(result.clips)
      };

      ctx.postMessage({ 
        type: 'SUCCESS', 
        csvs, 
        metadata: result.metadata,
        counts: {
          total: result.clips.length,
          transforms: result.clips.filter((c: any) => c.hasKeyframes || (c.scale && c.scale !== 100)).length,
          speed: result.clips.filter((c: any) => c.speed && c.speed !== 100).length
        }
      });
    } catch (error: any) {
      ctx.postMessage({ type: 'ERROR', error: error.message || 'Unknown parsing error' });
    }
  };
})();
