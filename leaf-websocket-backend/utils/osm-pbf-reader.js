'use strict';

// Leitor mínimo de OSM PBF (https://wiki.openstreetmap.org/wiki/PBF_Format), sem dependências:
// só o formato protobuf e o zlib do Node. Lê o necessário para a malha de ruas: ways com tags e
// nós (densos e simples) com coordenadas.

const zlib = require('zlib');

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let byte;
  do {
    byte = buf[pos];
    pos += 1;
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte >= 0x80);
  return [result, pos];
}

function zigzag(value) {
  return value % 2 === 1 ? -(value + 1) / 2 : value / 2;
}

// Percorre os campos de uma mensagem: { field, type, value } para varint e
// { field, type, start, end } para campos length-delimited.
function* fields(buf, start = 0, end = buf.length) {
  let pos = start;
  while (pos < end) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const type = key & 7;
    if (type === 0) {
      let value;
      [value, pos] = readVarint(buf, pos);
      yield { field, type, value };
    } else if (type === 2) {
      let length;
      [length, pos] = readVarint(buf, pos);
      yield { field, type, start: pos, end: pos + length };
      pos += length;
    } else if (type === 1) {
      pos += 8;
    } else if (type === 5) {
      pos += 4;
    } else {
      throw new Error(`Tipo protobuf não suportado: ${type}`);
    }
  }
}

function packedVarints(buf, start, end, signedDelta = false) {
  const out = [];
  let pos = start;
  let acc = 0;
  while (pos < end) {
    let value;
    [value, pos] = readVarint(buf, pos);
    if (signedDelta) {
      acc += zigzag(value);
      out.push(acc);
    } else {
      out.push(value);
    }
  }
  return out;
}

function readBlobData(buf, start, end) {
  let raw = null;
  let zlibData = null;
  for (const f of fields(buf, start, end)) {
    if (f.field === 1 && f.type === 2) raw = buf.subarray(f.start, f.end);
    if (f.field === 3 && f.type === 2) zlibData = buf.subarray(f.start, f.end);
  }
  if (raw) return raw;
  if (zlibData) return zlib.inflateSync(zlibData);
  throw new Error('Blob OSM sem dados suportados (só raw/zlib)');
}

function parsePrimitiveBlock(block, { onWay, onNode }) {
  const strings = [];
  const groups = [];
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;
  for (const f of fields(block)) {
    if (f.field === 1 && f.type === 2) {
      for (const s of fields(block, f.start, f.end)) {
        if (s.field === 1) strings.push(block.toString('utf8', s.start, s.end));
      }
    } else if (f.field === 2 && f.type === 2) {
      groups.push([f.start, f.end]);
    } else if (f.field === 17) {
      granularity = f.value;
    } else if (f.field === 19) {
      latOffset = zigzag(f.value);
    } else if (f.field === 20) {
      lonOffset = zigzag(f.value);
    }
  }
  const toDeg = (value, offset) => 1e-9 * (offset + granularity * value);

  for (const [gStart, gEnd] of groups) {
    for (const g of fields(block, gStart, gEnd)) {
      if (g.field === 2 && g.type === 2 && onNode) {
        let ids = [];
        let lats = [];
        let lons = [];
        for (const d of fields(block, g.start, g.end)) {
          if (d.field === 1) ids = packedVarints(block, d.start, d.end, true);
          else if (d.field === 8) lats = packedVarints(block, d.start, d.end, true);
          else if (d.field === 9) lons = packedVarints(block, d.start, d.end, true);
        }
        for (let i = 0; i < ids.length; i += 1) {
          onNode(ids[i], toDeg(lats[i], latOffset), toDeg(lons[i], lonOffset));
        }
      } else if (g.field === 1 && g.type === 2 && onNode) {
        let id = 0;
        let lat = 0;
        let lon = 0;
        for (const n of fields(block, g.start, g.end)) {
          if (n.field === 1) id = zigzag(n.value);
          else if (n.field === 8) lat = zigzag(n.value);
          else if (n.field === 9) lon = zigzag(n.value);
        }
        onNode(id, toDeg(lat, latOffset), toDeg(lon, lonOffset));
      } else if (g.field === 3 && g.type === 2 && onWay) {
        let id = 0;
        let keys = [];
        let vals = [];
        let refs = [];
        for (const w of fields(block, g.start, g.end)) {
          if (w.field === 1) id = w.value;
          else if (w.field === 2) keys = packedVarints(block, w.start, w.end);
          else if (w.field === 3) vals = packedVarints(block, w.start, w.end);
          else if (w.field === 8) refs = packedVarints(block, w.start, w.end, true);
        }
        const tags = {};
        for (let i = 0; i < keys.length; i += 1) tags[strings[keys[i]]] = strings[vals[i]];
        onWay(id, tags, refs);
      }
    }
  }
}

// Chama onWay(id, tags, refs) e onNode(id, lat, lon) para cada elemento do arquivo.
function readOsmPbf(buffer, handlers) {
  let pos = 0;
  while (pos + 4 <= buffer.length) {
    const headerLength = buffer.readUInt32BE(pos);
    pos += 4;
    let type = '';
    let dataSize = 0;
    for (const f of fields(buffer, pos, pos + headerLength)) {
      if (f.field === 1 && f.type === 2) type = buffer.toString('utf8', f.start, f.end);
      if (f.field === 3) dataSize = f.value;
    }
    pos += headerLength;
    const blobEnd = pos + dataSize;
    if (type === 'OSMData') {
      parsePrimitiveBlock(readBlobData(buffer, pos, blobEnd), handlers);
    }
    pos = blobEnd;
  }
}

module.exports = { readOsmPbf, helpers: { readVarint, zigzag, fields, packedVarints } };
