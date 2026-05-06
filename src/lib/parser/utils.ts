/**
 * Shared Parser Utilities
 *
 * Common functions used across parsing, CSV export, and EDL generation
 */

/**
 * Frame Rate Utilities
 */

/**
 * Detect if frame rate is NTSC (drop-frame)
 */
// Only 29.97 and 59.94 use drop-frame timecodes.
// 23.976 is NTSC but NON-drop-frame — using ';' or FCM: DROP FRAME for 23.976 is wrong.
export function isNTSCFrameRate(frameRate: number): boolean {
  return Math.abs(frameRate - 29.97) < 0.01 ||
         Math.abs(frameRate - 59.94) < 0.01;
}

/**
 * Round frame rate to common values for display
 */
export function roundFrameRate(frameRate: number): number {
  if (Math.abs(frameRate - 23.976) < 0.01) return 23.976;
  if (Math.abs(frameRate - 24) < 0.01) return 24;
  if (Math.abs(frameRate - 25) < 0.01) return 25;
  if (Math.abs(frameRate - 29.97) < 0.01) return 29.97;
  if (Math.abs(frameRate - 30) < 0.01) return 30;
  if (Math.abs(frameRate - 50) < 0.01) return 50;
  if (Math.abs(frameRate - 59.94) < 0.01) return 59.94;
  if (Math.abs(frameRate - 60) < 0.01) return 60;
  return Math.round(frameRate * 100) / 100;
}

/**
 * Timecode Conversion Utilities
 */

/**
 * Convert frames to timecode string
 * Automatically uses drop-frame separator for NTSC rates
 */
export function framesToTimecode(frames: number, frameRate: number): string {
  const totalSeconds = frames / frameRate;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frameNum = Math.floor(frames % frameRate);

  const isDropFrame = isNTSCFrameRate(frameRate);
  const frameSeparator = isDropFrame ? ';' : ':';

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${frameSeparator}${String(frameNum).padStart(2, '0')}`;
}

/**
 * Validation Utilities
 */

/**
 * Check if value is a valid number (not NaN)
 */
export function isValidNumber(value: any): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * Check if value is a non-empty string
 */
export function isNonEmptyString(value: any): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Check if value is a valid object (not null, not array)
 */
export function isValidObject(value: any): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Array Normalization Utilities
 */

/**
 * Ensure value is an array
 * Converts single values to array, handles null/undefined
 */
export function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Filter array to only valid objects
 */
export function filterValidObjects<T>(arr: any[]): T[] {
  return arr.filter(item => isValidObject(item)) as T[];
}

/**
 * String Utilities
 */

/**
 * Safely convert value to string, handling null/undefined
 */
export function safeString(value: any, defaultValue: string = ''): string {
  if (value === null || value === undefined) return defaultValue;
  return String(value);
}

/**
 * Escape CSV value
 * Handles commas, quotes, newlines, and carriage returns
 */
export function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // If value contains special characters, wrap in quotes and escape internal quotes
  if (stringValue.includes(',') ||
      stringValue.includes('"') ||
      stringValue.includes('\n') ||
      stringValue.includes('\r')) {
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }

  return stringValue;
}

/**
 * Position Utilities
 */

/**
 * Check if position is at center for given frame size.
 * Prefers timelineResolution when provided (accurate for the timeline coordinate space).
 * Falls back to sourceFrameSize string parsing, then 1920x1080 default.
 */
export function isPositionAtCenter(
  positionX: number | undefined,
  positionY: number | undefined,
  frameSize: string | undefined,
  timelineResolution?: { width: number; height: number }
): boolean {
  if (positionX === undefined || positionY === undefined) return true;

  // Prefer explicit timeline resolution (correct for the coordinate space)
  if (timelineResolution) {
    const centerX = timelineResolution.width / 2;
    const centerY = timelineResolution.height / 2;
    return positionX === centerX && positionY === centerY;
  }

  // Fall back to parsing frameSize string
  if (frameSize) {
    const match = frameSize.match(/(\d+)x(\d+)/);
    if (match) {
      const centerX = parseInt(match[1]) / 2;
      const centerY = parseInt(match[2]) / 2;
      return positionX === centerX && positionY === centerY;
    }
  }

  // Default HD center (1920x1080)
  return positionX === 960 && positionY === 540;
}

/**
 * Format Utilities
 */

/**
 * Format parameter value for CSV output
 */
export function formatParameterValue(value: string | number | { horiz: number; vert: number }): string {
  if (typeof value === 'object' && 'horiz' in value && 'vert' in value) {
    return `${value.horiz},${value.vert}`;
  }
  return String(value);
}

/**
 * Math Utilities
 */

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Safe number conversion with default value
 */
export function toNumber(value: any, defaultValue: number = 0): number {
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}
