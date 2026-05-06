/**
 * CSV Exporter (Web Version)
 *
 * Generates CSV strings from parsed clip data
 * This version is designed for web/serverless environments (no fs dependency)
 */

import { ClipData, EffectData, EffectParameter } from './types';
import { escapeCSV, formatParameterValue, isPositionAtCenter, isValidNumber } from './utils';

export class CSVExporter {

  private buildShotMap(clips: ClipData[]): Map<ClipData, number> {
    const map = new Map<ClipData, number>();
    let n = 1;
    clips.forEach(c => { if (c.trackType !== 'audio') map.set(c, n++); });
    return map;
  }

  generateMasterShotListCSV(clips: ClipData[]): string {
    let csv = 'Shot #,Timeline IN TC,Timeline OUT TC,Source Clip Name,Source IN TC,Source OUT TC,';
    csv += 'Source Frame Size,Source Frame Rate,Track,Speed,Scale,Rotation,Position X,Position Y,Keyframes,Effects Count\n';

    const shots = this.buildShotMap(clips);
    clips.forEach(clip => {
      const shotNum = shots.get(clip);
      csv += escapeCSV(shotNum !== undefined ? String(shotNum) : '') + ',';
      csv += escapeCSV(clip.timelineInTC) + ',';
      csv += escapeCSV(clip.timelineOutTC) + ',';
      csv += escapeCSV(clip.sourceClipName) + ',';
      csv += escapeCSV(clip.sourceInTC) + ',';
      csv += escapeCSV(clip.sourceOutTC) + ',';
      csv += escapeCSV(clip.sourceFrameSize || '') + ',';
      csv += escapeCSV(clip.sourceFrameRate ? String(clip.sourceFrameRate) : '') + ',';
      csv += escapeCSV(clip.trackNumber) + ',';
      csv += escapeCSV(clip.speed !== undefined ? String(clip.speed) : '100') + ',';
      csv += escapeCSV(clip.scale !== undefined ? String(clip.scale) : '100') + ',';
      csv += escapeCSV(clip.rotation !== undefined ? String(clip.rotation) : '0') + ',';
      csv += escapeCSV(isValidNumber(clip.positionX) ? String(clip.positionX) : '') + ',';
      csv += escapeCSV(isValidNumber(clip.positionY) ? String(clip.positionY) : '') + ',';
      csv += escapeCSV(clip.hasKeyframes ? 'Y' : 'N') + ',';
      csv += escapeCSV(String(clip.effects.length)) + '\n';
    });

    return csv;
  }

  generateTransformsCSV(clips: ClipData[], timelineResolution?: { width: number; height: number }): string {
    let csv = 'Shot #,Clip Name,Timeline IN TC,Track,Scale,Scale Keyframes,Rotation,Rotation Keyframes,Position X,Position Y,Position Keyframes,Anchor X,Anchor Y,Keyframes\n';

    const shots = this.buildShotMap(clips);
    const clipsWithTransforms = clips.filter(clip =>
      (clip.scale !== undefined && clip.scale !== 100) ||
      (clip.rotation !== undefined && clip.rotation !== 0) ||
      !isPositionAtCenter(clip.positionX, clip.positionY, clip.sourceFrameSize, timelineResolution) ||
      clip.scaleKeyframes ||
      clip.rotationKeyframes ||
      clip.positionKeyframes
    );

    clipsWithTransforms.forEach(clip => {
      csv += escapeCSV(String(shots.get(clip) ?? '')) + ',';
      csv += escapeCSV(clip.sourceClipName) + ',';
      csv += escapeCSV(clip.timelineInTC) + ',';
      csv += escapeCSV(clip.trackNumber) + ',';
      csv += escapeCSV(clip.scale !== undefined ? String(clip.scale) : '100') + ',';
      csv += escapeCSV(clip.scaleKeyframes || '') + ',';
      csv += escapeCSV(clip.rotation !== undefined ? String(clip.rotation) : '0') + ',';
      csv += escapeCSV(clip.rotationKeyframes || '') + ',';
      csv += escapeCSV(isValidNumber(clip.positionX) ? String(clip.positionX) : '') + ',';
      csv += escapeCSV(isValidNumber(clip.positionY) ? String(clip.positionY) : '') + ',';
      csv += escapeCSV(clip.positionKeyframes || '') + ',';
      csv += escapeCSV(clip.anchorX !== undefined ? String(clip.anchorX) : '0') + ',';
      csv += escapeCSV(clip.anchorY !== undefined ? String(clip.anchorY) : '0') + ',';
      csv += escapeCSV(clip.hasKeyframes ? 'Y' : 'N') + '\n';
    });

    return csv;
  }

  generateSpeedChangesCSV(clips: ClipData[]): string {
    let csv = 'Shot #,Clip Name,Timeline IN TC,Track,Speed,Speed Keyframes,Type,Keyframes\n';

    const shots = this.buildShotMap(clips);
    const clipsWithSpeed = clips.filter(clip =>
      clip.speed !== undefined && clip.speed !== 100
    );

    clipsWithSpeed.forEach(clip => {
      const speedType = clip.speed! < 0 ? 'Reverse' :
                       clip.speed! < 100 ? 'Slow Motion' : 'Fast Motion';

      csv += escapeCSV(String(shots.get(clip) ?? '')) + ',';
      csv += escapeCSV(clip.sourceClipName) + ',';
      csv += escapeCSV(clip.timelineInTC) + ',';
      csv += escapeCSV(clip.trackNumber) + ',';
      csv += escapeCSV(String(clip.speed)) + ',';
      csv += escapeCSV(clip.speedKeyframes || '') + ',';
      csv += escapeCSV(speedType) + ',';
      csv += escapeCSV(clip.hasKeyframes ? 'Y' : 'N') + '\n';
    });

    return csv;
  }

  generateEffectsInventoryCSV(clips: ClipData[]): string {
    let csv = 'Shot #,Clip Name,Timeline IN TC,Track,Effect Name,Effect ID,Category,Parameter Name,Parameter Value,Has Keyframes\n';

    const shots = this.buildShotMap(clips);
    clips.forEach(clip => {
      const shotNum = shots.get(clip);
      clip.effects.forEach(effect => {
        if (this.shouldSkipEffect(effect)) return;

        const visibleParams = effect.parameters.filter(param =>
          !this.shouldSkipParameter(effect, param)
        );

        if ((effect.effectId === 'Lumetri' || effect.effectId === 'lumetri') &&
            visibleParams.length === 0) {
          csv += escapeCSV(shotNum !== undefined ? String(shotNum) : '') + ',';
          csv += escapeCSV(clip.sourceClipName) + ',';
          csv += escapeCSV(clip.timelineInTC) + ',';
          csv += escapeCSV(clip.trackNumber) + ',';
          csv += escapeCSV(effect.name || 'Lumetri') + ',';
          csv += escapeCSV(effect.effectId) + ',';
          csv += escapeCSV(effect.category) + ',';
          csv += 'Applied,,No\n';
          return;
        }

        visibleParams.forEach(param => {
          csv += escapeCSV(shotNum !== undefined ? String(shotNum) : '') + ',';
          csv += escapeCSV(clip.sourceClipName) + ',';
          csv += escapeCSV(clip.timelineInTC) + ',';
          csv += escapeCSV(clip.trackNumber) + ',';
          csv += escapeCSV(effect.name) + ',';
          csv += escapeCSV(effect.effectId) + ',';
          csv += escapeCSV(effect.category) + ',';
          csv += escapeCSV(param.name) + ',';
          csv += escapeCSV(formatParameterValue(param.value)) + ',';
          csv += escapeCSV(param.hasKeyframes ? 'Yes' : 'No') + '\n';
        });
      });
    });

    return csv;
  }

  /**
   * Get counts for transforms and speed changes (useful for metadata)
   */
  getCounts(clips: ClipData[], timelineResolution?: { width: number; height: number }): { transformsCount: number; speedChangesCount: number; effectsCount: number } {
    const transformsCount = clips.filter(clip =>
      (clip.scale !== undefined && clip.scale !== 100) ||
      (clip.rotation !== undefined && clip.rotation !== 0) ||
      !isPositionAtCenter(clip.positionX, clip.positionY, clip.sourceFrameSize, timelineResolution)
    ).length;

    const speedChangesCount = clips.filter(clip =>
      clip.speed !== undefined && clip.speed !== 100
    ).length;

    const effectsCount = clips.filter(clip => clip.effects.length > 0).length;

    return { transformsCount, speedChangesCount, effectsCount };
  }

  /**
   * Determine if an effect should be skipped from the effects inventory
   */
  private shouldSkipEffect(effect: EffectData): boolean {
    // Skip effects with "Unknown Effect" name (but not Lumetri)
    if (effect.name === 'Unknown Effect' &&
        effect.effectId !== 'Lumetri' &&
        effect.effectId !== 'lumetri') {
      return true;
    }

    // Skip Basic Motion (already covered in transforms.csv)
    if (effect.effectId === 'basic' || effect.name === 'Basic Motion') {
      return true;
    }

    // Skip Time Remap (already covered in speed_changes.csv)
    if (effect.effectId === 'timeremap' || effect.name === 'Time Remap') {
      return true;
    }

    return false;
  }

  /**
   * Determine if a parameter should be skipped from the effects inventory
   */
  private shouldSkipParameter(effect: EffectData, param: EffectParameter): boolean {
    // Skip ALL Lumetri parameters (show effect applied, but no details)
    if (effect.effectId === 'Lumetri' || effect.effectId === 'lumetri') {
      return true;
    }

    // Skip empty parameter names
    if (!param.name || param.name.trim() === '') {
      return true;
    }

    // Skip magic number values (artifacts from other effects)
    const valueStr = String(param.value);
    if (valueStr.includes('-91445760000000000')) {
      return true;
    }

    // Skip base64 blobs longer than 100 chars
    if (typeof param.value === 'string' && param.value.length > 100 && /^[A-Za-z0-9+/=]+$/.test(param.value)) {
      return true;
    }

    return false;
  }

}
