/**
 * XMEML Parser
 *
 * Parses XMEML (Final Cut Pro XML) timeline files and extracts
 * clip data including transforms, effects, and speed changes.
 */

import { XMLParser } from 'fast-xml-parser';
import { ClipData, EffectData, EffectParameter, ParseResult, TimelineMetadata } from './types';
import { createErrorLogger } from '../error-sanitizer';
import {
  isNTSCFrameRate,
  roundFrameRate,
  framesToTimecode,
  ensureArray,
  filterValidObjects,
  isValidObject,
} from './utils';

export class XMEMLParser {
  private parser: XMLParser;
  private logger = createErrorLogger('XMEMLParser');
  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      parseAttributeValue: false,
      trimValues: true,
      // Security: Disable entity processing to prevent XML bomb attacks
      processEntities: false,
      // Security: Stop parsing if entities are detected
      stopNodes: ['!ENTITY'],
    });
  }

  private validateXMLStructure(xmlContent: string): void {
    if (/<!ENTITY/i.test(xmlContent)) {
      throw new Error('XML contains entity declarations, which are not allowed.');
    }
  }

  /**
   * Parse XMEML file content
   */
  parse(xmlContent: string): ParseResult {
    // Security: Validate XML structure before parsing
    this.validateXMLStructure(xmlContent);

    const xmlData = this.parser.parse(xmlContent);

    // Find sequence
    const sequence = this.findSequence(xmlData);
    if (!sequence) {
      throw new Error('No sequence found in XMEML file');
    }

    // Extract metadata
    const metadata = this.extractMetadata(sequence);

    // Extract clips
    const clips = this.extractClips(sequence);

    // Update clip count in metadata
    metadata.clipCount = clips.length;

    return { metadata, clips };
  }

  /**
   * Find sequence in XML structure
   */
  private findSequence(xmlData: any): any {
    // Direct sequence in XMEML (timeline export format)
    if (xmlData.xmeml?.sequence) {
      return Array.isArray(xmlData.xmeml.sequence)
        ? xmlData.xmeml.sequence[0]
        : xmlData.xmeml.sequence;
    }

    // Premiere Pro XMEML format (project export format)
    if (xmlData.xmeml?.project?.children?.sequence) {
      const seq = xmlData.xmeml.project.children.sequence;
      return Array.isArray(seq) ? seq[0] : seq;
    }

    return null;
  }

  /**
   * Extract timeline metadata
   */
  private extractMetadata(sequence: any): TimelineMetadata {
    const frameRate = roundFrameRate(this.extractFrameRate(sequence));

    return {
      name: sequence.name || 'Untitled',
      frameRate,
      duration: parseInt(String(sequence.duration || 0)),
      clipCount: 0, // Will be updated after parsing clips
      resolution: this.extractResolution(sequence),
    };
  }

  /**
   * Extract frame rate from sequence
   */
  private extractFrameRate(sequence: any): number {
    if (sequence.rate) {
      const timebase = typeof sequence.rate.timebase === 'number'
        ? sequence.rate.timebase
        : parseInt(String(sequence.rate.timebase || 30));
      const ntsc = sequence.rate.ntsc === 'TRUE' || sequence.rate.ntsc === true;

      // Return actual frame rate (accounting for NTSC drop frame)
      return ntsc ? timebase * 1000 / 1001 : timebase;
    }

    return 29.97; // Default
  }

  /**
   * Extract resolution from sequence
   */
  private extractResolution(sequence: any): { width: number; height: number } | undefined {
    try {
      // Primary: sequence-level format block — this IS the timeline resolution
      const sc = sequence?.media?.video?.format?.samplecharacteristics;
      if (sc?.width && sc?.height) {
        return {
          width: parseInt(String(sc.width)),
          height: parseInt(String(sc.height)),
        };
      }
    } catch (error) {
      this.logger.warn('Could not extract resolution', { error });
    }

    return undefined;
  }

  /**
   * Extract all clips from sequence
   */
  private extractClips(sequence: any): ClipData[] {
    const clips: ClipData[] = [];

    if (!sequence.media) {
      return clips;
    }

    const frameRate = this.extractFrameRate(sequence);

    // Process video tracks
    if (sequence.media.video?.track) {
      const videoTracks = Array.isArray(sequence.media.video.track)
        ? sequence.media.video.track
        : [sequence.media.video.track];

      videoTracks.forEach((track: any, trackIndex: number) => {
        // Validate track is an object
        if (!track || typeof track !== 'object') {
          this.logger.warn('Invalid video track, skipping', { trackIndex });
          return;
        }

        if (track.clipitem) {
          const clipItems = Array.isArray(track.clipitem) ? track.clipitem : [track.clipitem];
          clipItems.forEach((clipItem: any, clipIndex: number) => {
            // Validate clipItem is an object
            if (!clipItem || typeof clipItem !== 'object') {
              this.logger.warn('Invalid clip item at video track, skipping', { trackNumber: trackIndex + 1, clipIndex });
              return;
            }

            const clip = this.parseClipItem(clipItem, trackIndex + 1, 'video', frameRate, clipIndex);
            if (clip) {
              clips.push(clip);
            }
          });
        }
      });
    }

    // Process audio tracks
    if (sequence.media.audio?.track) {
      const audioTracks = Array.isArray(sequence.media.audio.track)
        ? sequence.media.audio.track
        : [sequence.media.audio.track];

      audioTracks.forEach((track: any, trackIndex: number) => {
        // Validate track is an object
        if (!track || typeof track !== 'object') {
          this.logger.warn('Invalid audio track, skipping', { trackIndex });
          return;
        }

        if (track.clipitem) {
          const clipItems = Array.isArray(track.clipitem) ? track.clipitem : [track.clipitem];
          clipItems.forEach((clipItem: any, clipIndex: number) => {
            // Validate clipItem is an object
            if (!clipItem || typeof clipItem !== 'object') {
              this.logger.warn('Invalid clip item at audio track, skipping', { trackNumber: trackIndex + 1, clipIndex });
              return;
            }

            const clip = this.parseClipItem(clipItem, trackIndex + 1, 'audio', frameRate, clipIndex);
            if (clip) {
              clips.push(clip);
            }
          });
        }
      });
    }

    return clips;
  }

  /**
   * Parse a single clipitem
   */
  private parseClipItem(
    clipItem: any,
    trackIndex: number,
    trackType: 'video' | 'audio',
    frameRate: number,
    clipIndex: number = 0
  ): ClipData | null {
    try {
      let start = parseInt(String(clipItem.start || 0));
      let end = parseInt(String(clipItem.end || 0));
      const inPoint = parseInt(String(clipItem.in || 0));
      const outPoint = parseInt(String(clipItem.out || 0));
      const duration = parseInt(String(clipItem.duration || 0));

      // Fix negative start frames (clips with transitions that extend before sequence start)
      // Calculate actual visible timeline position from end and duration
      if (start < 0 && end > 0 && duration > 0) {
        start = end - duration;
      }

      // Fix negative end frames (clips with transitions at end)
      if (end < 0 && start >= 0 && duration > 0) {
        end = start + duration;
      }

      // Edge case: Both start and end are negative (rare, but handle it)
      if (start < 0 && end < 0 && duration > 0) {
        // Assume clip starts at frame 0 (can't determine actual position)
        start = 0;
        end = duration;
      }

      // Extract source info
      const sourceClipName = clipItem.name || clipItem.file?.name || 'Unknown';
      const sourceFrameSize = this.extractSourceFrameSize(clipItem);
      const sourceFrameRate = this.extractSourceFrameRate(clipItem);

      // Parse effects
      const effects = this.parseEffects(clipItem);

      // Extract transform data from Basic Motion effect
      // Pass frame size for position conversion
      const transforms = this.extractTransforms(effects, sourceFrameSize);

      // Extract speed from Time Remapping or speed attribute
      const speedData = this.extractSpeed(clipItem, effects);

      // Determine if clip has any keyframes
      const hasKeyframes = !!(
        transforms.scaleKeyframes ||
        transforms.rotationKeyframes ||
        transforms.positionKeyframes ||
        speedData.speedKeyframes ||
        effects.some(e => e.parameters.some(p => p.hasKeyframes))
      );

      const clip: ClipData = {
        timelineInTC: framesToTimecode(start, frameRate),
        timelineOutTC: framesToTimecode(end, frameRate),
        sourceClipName,
        sourceInTC: framesToTimecode(inPoint, frameRate),
        sourceOutTC: framesToTimecode(outPoint, frameRate),
        sourceFrameSize,
        sourceFrameRate,
        trackNumber: `${trackType === 'video' ? 'V' : 'A'}${trackIndex}`,
        trackType,
        ...transforms,
        ...speedData,
        hasKeyframes,
        effects,
      };

      return clip;
    } catch (error) {
      this.logger.error(error, {
        clipIndex,
        clipName: clipItem.name || clipItem.file?.name || 'Unknown',
        trackType,
        trackNumber: trackIndex,
      });
      return null;
    }
  }

  /**
   * Extract source frame size
   */
  private extractSourceFrameSize(clipItem: any): string | undefined {
    try {
      if (clipItem.file?.media?.video?.samplecharacteristics) {
        const sc = clipItem.file.media.video.samplecharacteristics;
        const width = parseInt(String(sc.width || 0));
        const height = parseInt(String(sc.height || 0));
        if (width && height) {
          return `${width}x${height}`;
        }
      }
    } catch (error) {
      // Ignore
    }
    return undefined;
  }

  /**
   * Extract source frame rate
   */
  private extractSourceFrameRate(clipItem: any): number | undefined {
    try {
      if (clipItem.file?.rate) {
        const timebase = parseInt(String(clipItem.file.rate.timebase || 0));
        const ntsc = clipItem.file.rate.ntsc === 'TRUE' || clipItem.file.rate.ntsc === true;
        if (timebase) {
          const rawFrameRate = ntsc ? timebase * 1000 / 1001 : timebase;
          return roundFrameRate(rawFrameRate);
        }
      }
    } catch (error) {
      // Ignore
    }
    return undefined;
  }

  /**
   * Parse all effects from clipitem
   */
  private parseEffects(clipItem: any): EffectData[] {
    const effects: EffectData[] = [];

    if (!clipItem.filter) {
      return effects;
    }

    // Filter can be single object or array
    const filters = Array.isArray(clipItem.filter) ? clipItem.filter : [clipItem.filter];

    filters.forEach((filter: any) => {
      if (filter.effect) {
        const effectObjs = Array.isArray(filter.effect) ? filter.effect : [filter.effect];

        effectObjs.forEach((effect: any) => {
          const effectData: EffectData = {
            name: effect.name || effect.effectid || 'Unknown Effect',
            effectId: effect.effectid || '',
            category: effect.effectcategory || '',
            type: effect.effecttype || '',
            parameters: this.parseParameters(effect.parameter),
          };

          effects.push(effectData);
        });
      }
    });

    return effects;
  }

  /**
   * Parse effect parameters
   */
  private parseParameters(paramData: any): EffectParameter[] {
    const parameters: EffectParameter[] = [];

    if (!paramData) {
      return parameters;
    }

    const params = Array.isArray(paramData) ? paramData : [paramData];

    params.forEach(param => {
      let value: string | number | { horiz: number; vert: number } = '';

      // Handle different value types
      if (param.value !== undefined && param.value !== null) {
        if (typeof param.value === 'object' && 'horiz' in param.value && 'vert' in param.value) {
          // Position/center value
          value = {
            horiz: parseFloat(String(param.value.horiz || 0)),
            vert: parseFloat(String(param.value.vert || 0)),
          };
        } else {
          // Numeric or string value
          const numValue = parseFloat(String(param.value));
          value = isNaN(numValue) ? String(param.value) : numValue;
        }
      }

      // Parse keyframes if they exist
      let keyframes: any[] | undefined = undefined;
      if (param.keyframe) {
        const keyframeData = Array.isArray(param.keyframe) ? param.keyframe : [param.keyframe];
        keyframes = keyframeData.map((kf: any) => {
          let kfValue: string | number | { horiz: number; vert: number } = '';

          if (kf.value !== undefined && kf.value !== null) {
            if (typeof kf.value === 'object' && 'horiz' in kf.value && 'vert' in kf.value) {
              // Position/center keyframe
              kfValue = {
                horiz: parseFloat(String(kf.value.horiz || 0)),
                vert: parseFloat(String(kf.value.vert || 0)),
              };
            } else {
              // Numeric or string keyframe
              const numValue = parseFloat(String(kf.value));
              kfValue = isNaN(numValue) ? String(kf.value) : numValue;
            }
          }

          return {
            when: parseInt(String(kf.when || 0)),
            value: kfValue,
          };
        });
      }

      const parameter: EffectParameter = {
        id: param.parameterid || '',
        name: param.name || '',
        value,
        hasKeyframes: !!param.keyframe,
        keyframes,
      };

      parameters.push(parameter);
    });

    return parameters;
  }

  /**
   * Extract transform values from Basic Motion effect
   */
  private extractTransforms(effects: EffectData[], frameSize?: string): Partial<ClipData> {
    const transforms: Partial<ClipData> = {};

    // Parse frame size for position conversion (e.g., "3840x2160")
    let frameWidth = 1920;  // Default HD width
    let frameHeight = 1080; // Default HD height
    if (frameSize) {
      const match = frameSize.match(/(\d+)x(\d+)/);
      if (match) {
        frameWidth = parseInt(match[1]);
        frameHeight = parseInt(match[2]);
      }
    }

    // Find Basic Motion effect
    const motionEffect = effects.find(e =>
      e.name === 'Basic Motion' ||
      e.effectId === 'basic' ||
      e.category === 'motion'
    );

    if (!motionEffect) {
      return transforms;
    }

    // Helper: Check if parameter has non-default values (including keyframes)
    const hasNonDefaultNumeric = (param: any, defaultValue: number): boolean => {
      if (!param || typeof param.value !== 'number') return false;

      // Check base value
      if (param.value !== defaultValue) return true;

      // Check keyframe values if they exist
      if (param.keyframes && Array.isArray(param.keyframes)) {
        return param.keyframes.some((kf: any) =>
          typeof kf.value === 'number' && kf.value !== defaultValue
        );
      }

      return false;
    };

    // Helper: Check if position parameter has non-default values
    const hasNonDefaultPosition = (param: any): boolean => {
      if (!param || typeof param.value !== 'object') return false;

      // Check base value
      if (param.value.horiz !== 0 || param.value.vert !== 0) return true;

      // Check keyframe values if they exist
      if (param.keyframes && Array.isArray(param.keyframes)) {
        return param.keyframes.some((kf: any) =>
          typeof kf.value === 'object' &&
          (kf.value.horiz !== 0 || kf.value.vert !== 0)
        );
      }

      return false;
    };

    // Extract scale (use first keyframe value if exists, otherwise base value)
    const scaleParam = motionEffect.parameters.find(p => p.id === 'scale');
    if (scaleParam && typeof scaleParam.value === 'number') {
      if (scaleParam.keyframes && scaleParam.keyframes.length > 0) {
        // Use first keyframe value if keyframes exist
        const firstKeyframe = scaleParam.keyframes[0];
        if (typeof firstKeyframe.value === 'number') {
          transforms.scale = firstKeyframe.value;
        }
        // Generate keyframe range string
        const keyframeValues = scaleParam.keyframes
          .map(kf => typeof kf.value === 'number' ? `${kf.value}%` : String(kf.value))
          .join(' → ');
        transforms.scaleKeyframes = keyframeValues;
      } else {
        transforms.scale = scaleParam.value;
      }
    }

    // Extract rotation (use first keyframe value if exists, otherwise base value)
    const rotationParam = motionEffect.parameters.find(p => p.id === 'rotation');
    if (rotationParam && typeof rotationParam.value === 'number') {
      if (rotationParam.keyframes && rotationParam.keyframes.length > 0) {
        const firstKeyframe = rotationParam.keyframes[0];
        if (typeof firstKeyframe.value === 'number') {
          transforms.rotation = firstKeyframe.value;
        }
        // Generate keyframe range string
        const keyframeValues = rotationParam.keyframes
          .map(kf => typeof kf.value === 'number' ? `${kf.value}°` : String(kf.value))
          .join(' → ');
        transforms.rotationKeyframes = keyframeValues;
      } else {
        transforms.rotation = rotationParam.value;
      }
    }

    // Helper: Convert normalized position to pixel coordinates
    const normalizedToPixels = (horiz: number, vert: number): { x: number; y: number } => {
      // XMEML stores position as normalized offsets (fraction of frame size)
      // Formula: Actual = Center + (Normalized × FrameDimension)
      const pixelX = Math.round((frameWidth / 2) + (horiz * frameWidth));
      const pixelY = Math.round((frameHeight / 2) + (vert * frameHeight));
      return { x: pixelX, y: pixelY };
    };

    // Extract position (use first keyframe value if exists, otherwise base value)
    const centerParam = motionEffect.parameters.find(p => p.id === 'center');
    if (centerParam && typeof centerParam.value === 'object') {
      if (centerParam.keyframes && centerParam.keyframes.length > 0) {
        const firstKeyframe = centerParam.keyframes[0];
        if (typeof firstKeyframe.value === 'object') {
          const pixels = normalizedToPixels(firstKeyframe.value.horiz, firstKeyframe.value.vert);
          transforms.positionX = pixels.x;
          transforms.positionY = pixels.y;
        }
        // Generate keyframe range string with pixel coordinates
        const keyframeValues = centerParam.keyframes
          .map(kf => {
            if (typeof kf.value === 'object') {
              const pixels = normalizedToPixels(kf.value.horiz, kf.value.vert);
              return `(${pixels.x}, ${pixels.y})`;
            }
            return String(kf.value);
          })
          .join(' → ');
        transforms.positionKeyframes = keyframeValues;
      } else {
        const pixels = normalizedToPixels(centerParam.value.horiz, centerParam.value.vert);
        transforms.positionX = pixels.x;
        transforms.positionY = pixels.y;
      }
    }

    // Extract anchor point
    const anchorParam = motionEffect.parameters.find(p => p.id === 'centerOffset' || p.id === 'anchorPoint');
    if (anchorParam && typeof anchorParam.value === 'object') {
      if (anchorParam.keyframes && anchorParam.keyframes.length > 0) {
        const firstKeyframe = anchorParam.keyframes[0];
        if (typeof firstKeyframe.value === 'object') {
          transforms.anchorX = firstKeyframe.value.horiz;
          transforms.anchorY = firstKeyframe.value.vert;
        }
      } else {
        transforms.anchorX = anchorParam.value.horiz;
        transforms.anchorY = anchorParam.value.vert;
      }
    }

    return transforms;
  }

  /**
   * Extract speed value and keyframes
   */
  private extractSpeed(clipItem: any, effects: EffectData[]): { speed?: number; speedKeyframes?: string } {
    // Check for Time Remapping effect
    // Prioritize exact effectId match to avoid false positives like "Timeline" or "Overtime"
    const timeEffect = effects.find(e =>
      e.effectId === 'timeremap' ||
      // Fallback: name must contain BOTH "time" AND "remap"
      (e.name.toLowerCase().includes('time') &&
       e.name.toLowerCase().includes('remap'))
    );

    if (timeEffect) {
      // Look for exact 'speed' parameter first (not 'variablespeed')
      let speedParam = timeEffect.parameters.find(p => p.id === 'speed');

      // Fallback to parameter name containing 'speed' but not 'variable'
      if (!speedParam) {
        speedParam = timeEffect.parameters.find(p =>
          p.name.toLowerCase().includes('speed') &&
          !p.name.toLowerCase().includes('variable')
        );
      }

      if (speedParam && typeof speedParam.value === 'number') {
        const result: { speed?: number; speedKeyframes?: string } = {
          speed: speedParam.value
        };

        // Generate keyframe range string if keyframes exist
        if (speedParam.keyframes && speedParam.keyframes.length > 0) {
          const keyframeValues = speedParam.keyframes
            .map(kf => typeof kf.value === 'number' ? `${kf.value}%` : String(kf.value))
            .join(' → ');
          result.speedKeyframes = keyframeValues;
        }

        return result;
      }
    }

    // Check clipitem speed attribute (Premiere Pro extension)
    if (clipItem.speed) {
      const speed = parseFloat(String(clipItem.speed));
      if (!isNaN(speed)) {
        return { speed };
      }
    }

    return {};
  }

}
