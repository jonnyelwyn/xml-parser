/**
 * Data types for XMEML parser
 */

export interface ClipData {
  // Timeline position
  timelineInTC: string;
  timelineOutTC: string;

  // Source info
  sourceClipName: string;
  sourceInTC: string;
  sourceOutTC: string;
  sourceFrameSize?: string;
  sourceFrameRate?: number;

  // Track info
  trackNumber: string; // V1, V2, A1, A2, etc.
  trackType: 'video' | 'audio';

  // Transform data (from Basic Motion effect)
  scale?: number;
  scaleKeyframes?: string; // Human-readable keyframe range (e.g., "107 → 100")
  rotation?: number;
  rotationKeyframes?: string;
  positionX?: number;
  positionY?: number;
  positionKeyframes?: string;
  anchorX?: number;
  anchorY?: number;

  // Speed (from Time Remapping)
  speed?: number; // 100 = normal, 50 = half speed, -100 = reverse
  speedKeyframes?: string;

  // Keyframe indicator
  hasKeyframes: boolean;

  // All effects applied
  effects: EffectData[];
}

export interface EffectData {
  name: string;
  effectId: string;
  category: string;
  type: string;
  parameters: EffectParameter[];
}

export interface Keyframe {
  when: number; // frame number relative to clip start
  value: string | number | { horiz: number; vert: number };
}

export interface EffectParameter {
  id: string;
  name: string;
  value: string | number | { horiz: number; vert: number };
  hasKeyframes?: boolean;
  keyframes?: Keyframe[]; // Array of keyframe values
}

export interface TimelineMetadata {
  name: string;
  frameRate: number;
  duration: number; // in frames
  clipCount: number;
  resolution?: {
    width: number;
    height: number;
  };
}

export interface ParseResult {
  metadata: TimelineMetadata;
  clips: ClipData[];
}
