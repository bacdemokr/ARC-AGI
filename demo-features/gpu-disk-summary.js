// Build a dependency-free CommonJS function summarizing GPU temperature and disk usage.
// PM → Dev. 2026-10-12T02:29:34.131Z

// Usage: const { summarizeSystemHealth } = require('./gpu-disk-summary'); const summary = summarizeSystemHealth(input);
'use strict';

/*
Default thresholds:
- GPU temperature: warning at 80°C, critical at 90°C.
- Disk utilization: warning at 80%, critical at 90%.

Optional input shape:
{
  gpuTemperatures: [{ id: 'gpu0', temperature: 76 }],
  diskUsage: [{ mount: '/', used: 80, total: 100 }],
  thresholds: {
    gpu: { warning: 75, critical: 85 },
    disk: { warning: 85, critical: 95 }
  }
}

GPU records may use: temperature, temp, value, or a numeric value.
Disk records may use: percent, utilization, usage, used/total, or a numeric value.
*/

var DEFAULT_THRESHOLDS = {
  gpu: { warning: 80, critical: 90 },
  disk: { warning: 80, critical: 90 }
};

var SEVERITY = {
  ok: 0,
  warning: 1,
  critical: 2
};

function summarizeSystemHealth(input) {
  input = isPlainObject(input) ? input : {};

  var thresholds = {
    gpu: resolveThresholds(input.thresholds && input.thresholds.gpu, DEFAULT_THRESHOLDS.gpu),
    disk: resolveThresholds(input.thresholds && input.thresholds.disk, DEFAULT_THRESHOLDS.disk)
  };

  var gpu = normalizeRecords(
    firstDefined(input.gpuTemperatures, input.gpus, input.gpu),
    'GPU',
    normalizeGpuRecord,
    thresholds.gpu
  );

  var disks = normalizeRecords(
    firstDefined(input.diskUsage, input.disks, input.disk),
    'Disk',
    normalizeDiskRecord,
    thresholds.disk
  );

  var status = highestStatus(gpu.items.concat(disks.items));
  var messages = gpu.messages.concat(disks.messages);

  if (thresholds.gpu.usedDefaults) {
    messages.push('GPU thresholds: warning at ' + thresholds.gpu.warning + '°C, critical at ' + thresholds.gpu.critical + '°C.');
  }
  if (thresholds.disk.usedDefaults) {
    messages.push('Disk thresholds: warning at ' + thresholds.disk.warning + '%, critical at ' + thresholds.disk.critical + '%.');
  }

  return {
    status: status,
    healthy: status === 'ok',
    gpu: {
      status: highestStatus(gpu.items),
      devices: gpu.items
    },
    disks: {
      status: highestStatus(disks.items),
      devices: disks.items
    },
    messages: messages
  };
}

function normalizeRecords(source, kind, normalizer, thresholds) {
  var records = recordsFrom(source);
  var items = [];
  var messages = [];

  if (!records.length) {
    messages.push('No ' + kind.toLowerCase() + ' readings supplied.');
    return { items: items, messages: messages };
  }

  records.forEach(function (entry, index) {
    var item = normalizer(entry.value, entry.name, index, thresholds);
    items.push(item);
    messages.push(item.message);
  });

  return { items: items, messages: messages };
}

function normalizeGpuRecord(record, fallbackName, index, thresholds) {
  var source = isPlainObject(record) ? record : {};
  var name = recordName(source, fallbackName || ('GPU ' + index), 'GPU ' + index);
  var raw = isPlainObject(record)
    ? firstDefined(source.temperature, source.temp, source.value)
    : record;
  var value = toFiniteNumber(raw);

  return makeItem('gpu', name, value, '°C', thresholds, raw, function (temperature) {
    return temperature >= 0 && temperature <= 150;
  });
}

function normalizeDiskRecord(record, fallbackName, index, thresholds) {
  var source = isPlainObject(record) ? record : {};
  var name = recordName(source, fallbackName || ('Disk ' + index), 'Disk ' + index);
  var raw;
  var value;

  if (isPlainObject(record)) {
    raw = firstDefined(source.percent, source.utilization, source.usage, source.value);

    if (raw === undefined && source.used !== undefined && source.total !== undefined) {
      var used = toFiniteNumber(source.used);
      var total = toFiniteNumber(source.total);
      raw = { used: source.used, total: source.total };
      value = used === null || total === null || total <= 0 ? null : (used / total) * 100;
    } else {
      value = toFiniteNumber(raw);
    }
  } else {
    raw = record;
    value = toFiniteNumber(raw);
  }

  return makeItem('disk', name, value, '%', thresholds, raw, function (utilization) {
    return utilization >= 0 && utilization <= 100;
  });
}

function makeItem(type, name, value, unit, thresholds, raw, isInRange) {
  if (value === null) {
    return {
      type: type,
      name: name,
      value: null,
      unit: unit,
      status: 'critical',
      available: false,
      invalid: true,
      message: name + ': unavailable or invalid reading.'
    };
  }

  if (!isInRange(value)) {
    return {
      type: type,
      name: name,
      value: value,
      unit: unit,
      status: 'critical',
      available: false,
      invalid: true,
      message: name + ': invalid reading (' + formatNumber(value) + unit + ').'
    };
  }

  var status = value >= thresholds.critical
    ? 'critical'
    : value >= thresholds.warning
      ? 'warning'
      : 'ok';

  return {
    type: type,
    name: name,
    value: round(value, 1),
    unit: unit,
    status: status,
    available: true,
    invalid: false,
    message: name + ': ' + formatNumber(value) + unit + ' (' + status + ').'
  };
}

function resolveThresholds(candidate, defaults) {
  candidate = isPlainObject(candidate) ? candidate : {};
  var warning = toFiniteNumber(candidate.warning);
  var critical = toFiniteNumber(candidate.critical);

  if (warning === null || critical === null || warning < 0 || critical <= warning) {
    return {
      warning: defaults.warning,
      critical: defaults.critical,
      usedDefaults: true
    };
  }

  return {
    warning: warning,
    critical: critical,
    usedDefaults: false
  };
}

function recordsFrom(source) {
  if (Array.isArray(source)) {
    return source.map(function (value, index) {
      return { name: null, value: value, index: index };
    });
  }

  if (isPlainObject(source)) {
    return Object.keys(source).map(function (name, index) {
      return { name: name, value: source[name], index: index };
    });
  }

  return [];
}

function highestStatus(items) {
  if (!items.length) return 'critical';

  return items.reduce(function (highest, item) {
    return SEVERITY[item.status] > SEVERITY[highest] ? item.status : highest;
  }, 'ok');
}

function recordName(record, fallbackName, defaultName) {
  var candidate = firstDefined(record.name, record.id, record.device, record.mount, record.path, fallbackName);
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : defaultName;
}

function firstDefined() {
  for (var i = 0; i < arguments.length; i += 1) {
    if (arguments[i] !== undefined) return arguments[i];
  }
  return undefined;
}

function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    var parsed = Number(value.trim().replace(/%$/, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatNumber(value) {
  return String(round(value, 1));
}

function round(value, decimals) {
  var factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  summarizeSystemHealth: summarizeSystemHealth
};

if (require.main === module) {
  var result = summarizeSystemHealth({
    gpuTemperatures: [{ id: 'GPU 0', temperature: 82 }],
    diskUsage: [{ mount: '/', used: 45, total: 100 }]
  });

  if (result.status !== 'warning' || result.gpu.devices[0].status !== 'warning' || result.disks.devices[0].status !== 'ok') {
    throw new Error('Self-test failed');
  }
}
