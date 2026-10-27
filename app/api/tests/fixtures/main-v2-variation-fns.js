// Snapshot of the main v2 variation functions used by tests/unit/variation-parity.test.ts,
// sliced by name from D:client workss newmain v2index.html on 2026-10-14.
// Used only when the main v2 folder is not next to v1 (V1-only repository). When both exist,
// the parity test fails if this snapshot differs from main v2, so refresh it then.

function abbrLookup(attrDefs) {
  var map = {};
  (attrDefs || []).forEach(function(d) {
    if (!d || !d.abbrMap) return;
    var name = String(d.name || '').trim();
    Object.keys(d.abbrMap).forEach(function(v) {
      var ab = String(d.abbrMap[v] == null ? '' : d.abbrMap[v]).trim();
      if (!ab) return;
      map[name + '\u0000' + String(v).trim().toLowerCase()] = ab.toUpperCase();
    });
  });
  return map;
}

function variationCode(base, attrs, attrDefs, withUnits) {
  var unitOf = {};
  if (withUnits) (attrDefs || []).forEach(function(d) { if (d && !d.isQuality) unitOf[String(d.name || '').trim()] = String(d.unit || '').trim(); });
  var abbrOf = abbrLookup(attrDefs);
  var parts = [];
  (Object.keys(attrs || {})).forEach(function(k) {
    var raw = String(attrs[k] == null ? '' : attrs[k]).trim();
    var name = String(k).trim();
    var ab = raw ? String(abbrOf[name + '\u0000' + raw.toLowerCase()] || '') : '';
    var u = (withUnits && !ab) ? String(unitOf[name] || '') : '';
    var tok = ab || raw;
    if (raw && u) {
      var uu = u.toUpperCase();
      if (raw.toUpperCase().slice(-uu.length) !== uu) tok = raw + uu;
    }
    parts.push(tok);
  });
  parts.push(String(base == null ? '' : base).trim().toUpperCase().replace(/\s+/g, '-'));
  var code = parts.filter(Boolean).join('-');
  return code.replace(/\s+/g, '-');
}

function autoVariationShortName(base, attrs, attrDefs) {
  return variationCode(base, attrs, attrDefs, true);
}

function autoVariationSku(base, attrs, attrDefs) {
  return variationCode(base, attrs, attrDefs, false);
}

function attrComboKey(attrs) {
  return Object.keys(attrs || {}).sort().map(function(k) { return k + '=' + String(attrs[k] == null ? '' : attrs[k]).trim(); }).join('|');
}

function normAttrVals(d) {
  if (!d) return [];
  if (d.isQuality) return (d.stars || []).slice().sort(function(a, b) { return a - b; }).map(String);
  if (d.sub) {
    return (d.pairs || []).map(function(p) {
      var a = String(p.a || '').trim(), b = String(p.b || '').trim();
      if (!a && !b) return '';
      var su = String(d.subUnit || '').trim();
      return a + (b ? ' (' + b + (su ? ' ' + su : '') + ')' : '');
    }).filter(function(v) { return v; });
  }
  return (d.values || []).map(function(x) { return String(x).trim(); }).filter(Boolean);
}
