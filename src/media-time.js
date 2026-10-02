const COLON_RE = /[：﹕]/g;
const DOT_RE = /[．。]/g;

function parseNumericToken(token, label, allowFraction) {
  const pattern = allowFraction ? /^\d+(?:\.\d+)?$/ : /^\d+$/;
  if (!pattern.test(token)) throw new Error(label + '格式无效');
  const value = Number(token);
  if (!Number.isFinite(value)) throw new Error(label + '格式无效');
  return value;
}

export function parseMediaTime(value, options = {}) {
  const {
    empty = undefined,
    max = Infinity,
    label = '时间'
  } = options;

  const raw = String(value ?? '')
    .trim()
    .replace(COLON_RE, ':')
    .replace(DOT_RE, '.');

  if (!raw) {
    if (empty !== undefined) return empty;
    throw new Error(label + '不能为空');
  }

  if (raw.startsWith('-')) throw new Error(label + '不能为负数');
  const parts = raw.split(':');
  if (parts.length < 1 || parts.length > 3 || parts.some(part => part === '')) {
    throw new Error(label + '格式无效；支持 SS、MM:SS、HH:MM:SS');
  }

  let seconds;
  if (parts.length === 1) {
    seconds = parseNumericToken(parts[0], label, true);
  } else if (parts.length === 2) {
    const minutes = parseNumericToken(parts[0], label, false);
    const second = parseNumericToken(parts[1], label, true);
    if (second >= 60) throw new Error(label + '中的秒必须小于 60');
    seconds = minutes * 60 + second;
  } else {
    const hours = parseNumericToken(parts[0], label, false);
    const minutes = parseNumericToken(parts[1], label, false);
    const second = parseNumericToken(parts[2], label, true);
    if (minutes >= 60) throw new Error(label + '中的分钟必须小于 60');
    if (second >= 60) throw new Error(label + '中的秒必须小于 60');
    seconds = hours * 3600 + minutes * 60 + second;
  }

  if (!Number.isFinite(seconds) || seconds < 0) throw new Error(label + '格式无效');
  if (Number.isFinite(max) && seconds > max + 1e-9) {
    throw new Error(label + '超出媒体时长');
  }
  return seconds;
}

export function formatMediaTimeInput(value, precision = 3) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const safePrecision = Math.max(0, Math.min(6, Number(precision) || 0));
  const scale = 10 ** safePrecision;
  const rounded = Math.round(seconds * scale) / scale;
  const whole = Math.floor(rounded);
  const fraction = rounded - whole;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const fractional = safePrecision > 0 && fraction > 0
    ? (fraction.toFixed(safePrecision).slice(1).replace(/0+$/, ''))
    : '';
  const secText = String(secs).padStart(2, '0') + fractional;
  return hours > 0
    ? hours + ':' + String(minutes).padStart(2, '0') + ':' + secText
    : minutes + ':' + secText;
}
