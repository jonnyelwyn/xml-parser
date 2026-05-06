import { ClipData, EffectData, EffectParameter } from './types';
import { isNTSCFrameRate } from './utils';

// ─── Resolve colour tokens ────────────────────────────────────────────────────
// Uses |C:ResolveColor* |M: |D: format — the only format Resolve parses on
// "Import Markers from EDL". The * LOC: format is Avid-only; Resolve ignores it.

type ResolveColor =
  | 'ResolveColorRed'   | 'ResolveColorBlue'    | 'ResolveColorGreen'
  | 'ResolveColorYellow'| 'ResolveColorCyan'    | 'ResolveColorPink'
  | 'ResolveColorPurple'| 'ResolveColorFuchsia' | 'ResolveColorRose'
  | 'ResolveColorLavender' | 'ResolveColorSky'  | 'ResolveColorMint'
  | 'ResolveColorLemon' | 'ResolveColorSand'    | 'ResolveColorCocoa'
  | 'ResolveColorCream';

const CATEGORY_COLOUR: Record<string, ResolveColor> = {
  keyframe:  'ResolveColorYellow',
  transform: 'ResolveColorRed',
  speed:     'ResolveColorCyan',
  crop:      'ResolveColorGreen',
  flip:      'ResolveColorPink',
  opacity:   'ResolveColorLavender',
  effect:    'ResolveColorBlue',
  multi:     'ResolveColorFuchsia',
};

const CATEGORY_LABEL: Record<string, string> = {
  keyframe:  'Keyframes',
  transform: 'Transform',
  speed:     'Speed',
  crop:      'Crop',
  flip:      'Flip',
  opacity:   'Opacity',
  effect:    'Effects',
};

const PRIORITY = ['keyframe', 'speed', 'flip', 'crop', 'transform', 'opacity', 'effect'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function numericParam(params: EffectParameter[], id: string): number {
  const p = params.find(x => x.id === id || x.name?.toLowerCase() === id);
  if (!p) return 0;
  const v = typeof p.value === 'number' ? p.value : parseFloat(String(p.value));
  return isNaN(v) ? 0 : v;
}

function paramHasKeyframes(params: EffectParameter[]): boolean {
  return params.some(p => p.hasKeyframes);
}

function getCrop(clip: ClipData): { l: number; r: number; t: number; b: number } | null {
  const e = clip.effects.find(x => x.effectId === 'crop' || x.name?.toLowerCase() === 'crop');
  if (!e) return null;
  const l = numericParam(e.parameters, 'left');
  const r = numericParam(e.parameters, 'right');
  const t = numericParam(e.parameters, 'top');
  const b = numericParam(e.parameters, 'bottom');
  return (l || r || t || b) ? { l, r, t, b } : null;
}

function getOpacity(clip: ClipData): number | null {
  const e = clip.effects.find(x => x.effectId === 'opacity' || x.name?.toLowerCase() === 'opacity');
  if (!e) return null;
  const p = e.parameters.find(x => x.id === 'opacity' || x.name?.toLowerCase() === 'opacity');
  if (!p) return null;
  const v = typeof p.value === 'number' ? p.value : parseFloat(String(p.value));
  return (!isNaN(v) && v !== 100) ? v : null;
}

function isFlipped(clip: ClipData): boolean {
  if (clip.scale !== undefined && clip.scale < 0) return true;
  return clip.effects.some(e => /flip/i.test(e.name) || /flip/i.test(e.effectId));
}

function otherEffects(clip: ClipData): EffectData[] {
  const skipIds = new Set(['basic', 'timeremap', 'crop', 'opacity', 'lumetri']);
  const skipNames = new Set(['basic motion', 'time remap', 'crop', 'opacity', 'lumetri color', 'lumetri']);
  return clip.effects.filter(e =>
    !skipIds.has(e.effectId?.toLowerCase()) &&
    !skipNames.has(e.name?.toLowerCase()) &&
    !/lumetri/i.test(e.name)
  );
}

function hasEffectKeyframes(clip: ClipData): boolean {
  return clip.effects.some(e =>
    !['basic', 'timeremap'].includes(e.effectId) &&
    paramHasKeyframes(e.parameters)
  );
}

// ─── Clip classification ──────────────────────────────────────────────────────

interface ClipAnalysis {
  categories: string[];
  notes: Record<string, string>;  // note per category — generators pick the right one
}

function analyseClip(clip: ClipData, shotNum: number): ClipAnalysis {
  const cats: string[] = [];
  const notes: Record<string, string> = {};
  const tag = `#${shotNum}`;

  const motionKeyframed = clip.hasKeyframes;
  const effectsKeyframed = hasEffectKeyframes(clip);
  if (motionKeyframed || effectsKeyframed) {
    cats.push('keyframe');
    notes.keyframe = `${tag}: KF`;
  }

  if (isFlipped(clip)) {
    cats.push('flip');
    notes.flip = `${tag}: Flip`;
  }

  if (clip.speed !== undefined && clip.speed !== 100) {
    cats.push('speed');
    const s = clip.speed;
    const label = s < 0 ? 'Rev' : s < 100 ? 'Slow' : 'Fast';
    notes.speed = `${tag}: ${s}% ${label}`;
  }

  const crop = getCrop(clip);
  if (crop !== null) {
    cats.push('crop');
    const cv: string[] = [];
    if (crop.l) cv.push(`L${Math.round(crop.l)}`);
    if (crop.r) cv.push(`R${Math.round(crop.r)}`);
    if (crop.t) cv.push(`T${Math.round(crop.t)}`);
    if (crop.b) cv.push(`B${Math.round(crop.b)}`);
    notes.crop = `${tag}: ${cv.join(' ')}`;
  }

  const hasScale    = clip.scale !== undefined && Math.abs(clip.scale) !== 100 && !isFlipped(clip);
  const hasRotation = clip.rotation !== undefined && clip.rotation !== 0;
  const hasPosition = (clip.positionX !== undefined && clip.positionX !== 0) ||
                      (clip.positionY !== undefined && clip.positionY !== 0);
  if (hasScale || hasRotation || hasPosition) {
    cats.push('transform');
    const tp: string[] = [];
    if (hasScale)    tp.push(`Scale ${clip.scale}%`);
    if (hasRotation) tp.push(`Rot ${clip.rotation}`);
    if (hasPosition) tp.push(`Pos ${clip.positionX},${clip.positionY}`);
    notes.transform = `${tag}: ${tp.join(' ')}`;
  }

  const opacity = getOpacity(clip);
  if (opacity !== null) {
    cats.push('opacity');
    notes.opacity = `${tag}: ${opacity}%`;
  }

  const other = otherEffects(clip);
  if (other.length > 0) {
    cats.push('effect');
    const names = [...new Set(other.map(e => e.name || e.effectId))];
    notes.effect = `${tag}: ${names.slice(0, 2).join(', ')}`;
  }

  return { categories: cats, notes };
}

// ─── EDL builder ─────────────────────────────────────────────────────────────

function nextFrameTC(tc: string, frameRate: number): string {
  const sep = tc.includes(';') ? ';' : ':';
  const parts = tc.replace(';', ':').split(':').map(Number);
  if (parts.length !== 4) return tc;
  let [hh, mm, ss, ff] = parts;
  const fps = Math.round(frameRate);
  ff += 1;
  if (ff >= fps) { ff = 0; ss += 1; }
  if (ss >= 60)  { ss = 0; mm += 1; }
  if (mm >= 60)  { mm = 0; hh += 1; }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${sep}${pad(ff)}`;
}

function buildEDL(
  events: Array<{ tc: string; color: ResolveColor; label: string; note: string }>,
  title: string,
  frameRate: number,
): string {
  const fcm = isNTSCFrameRate(frameRate) ? 'DROP FRAME' : 'NON-DROP FRAME';
  const cleanTitle = title.replace(/\.(xml|xmeml)$/i, '');

  let out = `TITLE: ${cleanTitle}\nFCM: ${fcm}\n\n`;

  events.forEach((ev, i) => {
    const n = String(i + 1).padStart(3, '0');
    const tcOut = nextFrameTC(ev.tc, frameRate);
    out += `${n}  001      V     C        ${ev.tc} ${tcOut} ${ev.tc} ${tcOut}\n`;
    out += ` ${ev.note} |C:${ev.color} |M:${ev.label} |D:1\n\n`;
  });

  return out;
}

function validTC(tc: string): boolean {
  return !!tc && !tc.startsWith('-');
}

// ─── Shot number assignment ───────────────────────────────────────────────────
// Video clips are numbered sequentially (1-based) in order — matching the
// Shot # column in the CSV shot list so artists can cross-reference.

function shotNumbers(clips: ClipData[]): Map<ClipData, number> {
  const map = new Map<ClipData, number>();
  let n = 1;
  clips.forEach(c => {
    if (c.trackType !== 'audio') map.set(c, n++);
  });
  return map;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class EDLExporter {

  generateTransformsEDL(clips: ClipData[], title: string, frameRate = 29.97): string {
    const shots = shotNumbers(clips);
    const events = clips
      .filter(c => c.trackType !== 'audio' && validTC(c.timelineInTC))
      .flatMap(c => {
        const a = analyseClip(c, shots.get(c)!);
        const relevant = a.categories.filter(x => ['transform', 'keyframe', 'flip'].includes(x));
        if (relevant.length === 0) return [];
        // Colour/label by category priority, but note always shows the most descriptive value
        const topCat = relevant.includes('keyframe') ? 'keyframe'
                     : relevant.includes('flip')     ? 'flip'
                     : 'transform';
        // Prefer transform note (has actual values) over keyframe note (just says KF)
        const note = a.notes.transform ?? a.notes.flip ?? a.notes.keyframe ?? '';
        return [{ tc: c.timelineInTC, color: CATEGORY_COLOUR[topCat], label: CATEGORY_LABEL[topCat], note }];
      });
    return buildEDL(events, title, frameRate);
  }

  generateSpeedChangesEDL(clips: ClipData[], title: string, frameRate = 29.97): string {
    const shots = shotNumbers(clips);
    const events = clips
      .filter(c => c.trackType !== 'audio' && validTC(c.timelineInTC) && c.speed !== undefined && c.speed !== 100)
      .map(c => {
        const a = analyseClip(c, shots.get(c)!);
        return { tc: c.timelineInTC, color: CATEGORY_COLOUR.speed, label: CATEGORY_LABEL.speed, note: a.notes.speed! };
      });
    return buildEDL(events, title, frameRate);
  }

  generateCropsEDL(clips: ClipData[], title: string, frameRate = 29.97): string {
    const shots = shotNumbers(clips);
    const events = clips
      .filter(c => c.trackType !== 'audio' && validTC(c.timelineInTC) && getCrop(c) !== null)
      .map(c => {
        const a = analyseClip(c, shots.get(c)!);
        return { tc: c.timelineInTC, color: CATEGORY_COLOUR.crop, label: CATEGORY_LABEL.crop, note: a.notes.crop! };
      });
    return buildEDL(events, title, frameRate);
  }

  generateEffectsEDL(clips: ClipData[], title: string, frameRate = 29.97): string {
    const shots = shotNumbers(clips);
    const events = clips
      .filter(c => c.trackType !== 'audio' && validTC(c.timelineInTC) && otherEffects(c).length > 0)
      .map(c => {
        const a = analyseClip(c, shots.get(c)!);
        return { tc: c.timelineInTC, color: CATEGORY_COLOUR.effect, label: CATEGORY_LABEL.effect, note: a.notes.effect! };
      });
    return buildEDL(events, title, frameRate);
  }

  generateCombinedEDL(clips: ClipData[], title: string, frameRate = 29.97): string {
    const shots = shotNumbers(clips);
    const events = clips
      .filter(c => c.trackType !== 'audio' && validTC(c.timelineInTC))
      .flatMap(c => {
        const a = analyseClip(c, shots.get(c)!);
        if (a.categories.length === 0) return [];
        const topCat = PRIORITY.find(p => a.categories.includes(p)) ?? a.categories[0];
        const isMulti = a.categories.length > 1;
        const color = isMulti ? CATEGORY_COLOUR.multi : CATEGORY_COLOUR[topCat];
        const label = isMulti
          ? a.categories.slice(0, 2).map(cat => CATEGORY_LABEL[cat]).join('+')
          : CATEGORY_LABEL[topCat];
        // Use the most descriptive note available (skip bare KF if better info exists)
        const note = a.notes.speed ?? a.notes.transform ?? a.notes.flip
                   ?? a.notes.crop ?? a.notes.opacity ?? a.notes.effect
                   ?? a.notes.keyframe ?? '';
        return [{ tc: c.timelineInTC, color, label, note }];
      });
    return buildEDL(events, title, frameRate);
  }
}
