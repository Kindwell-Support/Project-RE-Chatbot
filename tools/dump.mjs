import * as XLSX from 'xlsx';
import fs from 'fs';

const files = process.argv.slice(2);
for (const f of files) {
  const wb = XLSX.read(fs.readFileSync(f), { cellFormula: true, cellNF: true });
  console.log(`\n===== FILE: ${f} =====`);
  console.log('Sheets:', wb.SheetNames.join(' | '));
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    console.log(`\n--- SHEET: ${name} (ref: ${ws['!ref'] || 'empty'}) ---`);
    if (!ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;
        const parts = [addr];
        if (cell.f) parts.push(`F=${cell.f}`);
        if (cell.v !== undefined) parts.push(`V=${JSON.stringify(cell.v)}`);
        if (parts.length > 1) console.log(parts.join('  '));
      }
    }
  }
}
