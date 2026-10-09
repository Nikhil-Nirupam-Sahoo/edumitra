/**
 * VTT subtitle parser with color/background support.
 */

export interface ParsedVTTCue {
  startTime: number;
  endTime: number;
  text: string;
  style?: {
    color?: string;
    background?: string;
  };
}

/** Parse WebVTT content into structured cues. */
export function parseVTT(vttText: string): ParsedVTTCue[] {
  const cues: ParsedVTTCue[] = [];
  const lines = vttText.split('\n');
  
  let i = 0;
  // Skip WEBVTT header
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }
  
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || !line.includes('-->')) {
      i++;
      continue;
    }
    
    // Parse timestamp line: "00:00:01.000 --> 00:00:04.000"
    const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (!timeMatch) {
      i++;
      continue;
    }
    
    const startTime = parseTime(timeMatch[1]);
    const endTime = parseTime(timeMatch[2]);
    
    // Collect cue text (may span multiple lines)
    const cueLines: string[] = [];
    i++;
    while (i < lines.length && lines[i].trim() !== '') {
      cueLines.push(lines[i]);
      i++;
    }
    
    if (cueLines.length > 0) {
      // Parse inline styles like <c.color>text</c>
      const fullText = cueLines.join('\n');
      const { text, style } = parseCueStyles(fullText);
      
      cues.push({
        startTime,
        endTime,
        text,
        style,
      });
    }
    
    i++;
  }
  
  return cues;
}

/** Parse HH:MM:SS.mmm to seconds. */
function parseTime(timeStr: string): number {
  const [time, ms] = timeStr.split('.');
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600 + m * 60 + s + Number('0.' + ms);
}

/** Parse inline styles like <c.red>text</c> or <c.background:#ffff00>text</c>. */
function parseCueStyles(text: string): { text: string; style?: ParsedVTTCue['style'] } {
  const style: ParsedVTTCue['style'] = {};
  let cleanText = text;
  
  // Match <c.color> or <c.background:#color> tags
  const styleRegex = /<c\.([^>]+)>([^<]*)<\/c>/g;
  let match;
  let lastIndex = 0;
  let cleanResult = '';
  
  while ((match = styleRegex.exec(cleanText)) !== null) {
    const styleStr = match[1];
    const content = match[2];
    const beforeMatch = cleanText.slice(lastIndex, match.index);
    cleanResult += beforeMatch + content;
    lastIndex = match.index + match[0].length;
    
    if (styleStr.includes(':')) {
      // background:#color or color:#color
      const [prop, value] = styleStr.split(':');
      if (prop === 'background') style.background = value;
      else if (prop === 'color') style.color = value;
    } else {
      // Just a color name
      style.color = styleStr;
    }
  }
  
  cleanResult += cleanText.slice(lastIndex);
  
  // Also handle simple <c>text</c> for generic highlighting
  if (!style.color && !style.background) {
    const simpleMatch = cleanText.match(/<c>([^<]+)<\/c>/);
    if (simpleMatch) {
      style.color = '#7cf03d'; // default lime
      cleanResult = cleanText.replace(/<c>([^<]+)<\/c>/g, '$1');
    }
  }
  
  // Remove any remaining tags
  cleanResult = cleanResult.replace(/<[^>]+>/g, '');
  
  const finalStyle = (style.color || style.background) ? style : undefined;
  
  return { text: cleanResult.trim(), style: finalStyle };
}

/** Convert seconds to VTT timestamp. */
export function secondsToVTT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** Convert cues back to VTT format. */
export function cuesToVTT(cues: ParsedVTTCue[]): string {
  let vtt = 'WEBVTT\n\n';
  
  for (const cue of cues) {
    vtt += `${secondsToVTT(cue.startTime)} --> ${secondsToVTT(cue.endTime)}\n`;
    if (cue.style) {
      let text = cue.text;
      if (cue.style.color) {
        text = `<c.${cue.style.color}>${cue.text}</c>`;
      }
      if (cue.style.background) {
        text = `<c.background:${cue.style.background}>${text}</c>`;
      }
      vtt += `${text}\n\n`;
    } else {
      vtt += `${cue.text}\n\n`;
    }
  }
  
  return vtt;
}