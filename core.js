/* ФОП-помічник — розрахункове ядро (податки, ліміти, строки).
   Дзеркало taxes.py з бота. Працює і в браузері (window.Core), і в Node (тести). */
(function (root) {
  'use strict';

  // Показники на 1 січня року: МЗП і прожитковий мінімум для працездатних
  const RATES = {
    2026: { minWage: 8647, subsistence: 3328 },
  };
  const EP_G3 = 0.05, EP_G3_VAT = 0.03, VZ_G3 = 0.01;
  const LIMIT_MULT = { 1: 167, 2: 834, 3: 1167 };

  const r2 = (x) => Math.round(x * 100) / 100;

  function rates(year) {
    if (RATES[year]) return Object.assign({ exact: true, year }, RATES[year]);
    const last = Math.max(...Object.keys(RATES).map(Number));
    return Object.assign({ exact: false, year: last }, RATES[last]);
  }
  function esvMonth(y) { return r2(rates(y).minWage * 0.22); }
  function vzFixedMonth(y) { return r2(rates(y).minWage * 0.10); }
  function epMax(group, y) {
    const r = rates(y);
    return group === 1 ? r2(r.subsistence * 0.10) : r2(r.minWage * 0.20);
  }
  function limit(group, y) { return LIMIT_MULT[group] * rates(y).minWage; }

  // ---- дати (без часових поясів: працюємо з рядками YYYY-MM-DD) ----
  const pad = (n) => String(n).padStart(2, '0');
  function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function daysBetween(a, b) { return Math.round((parseISO(iso(b)) - parseISO(iso(a))) / 86400000); }
  function quarterOf(d) { return Math.floor(d.getMonth() / 3) + 1; }
  function quarterBounds(y, q) { return [new Date(y, 3 * q - 3, 1), new Date(y, 3 * q, 0)]; }
  function shiftWeekend(d) {
    const x = new Date(d);
    while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1);
    return x;
  }

  // ---- податки ----
  function sumIncome(incomes, from, to) {
    const a = iso(from), b = iso(to);
    return r2(incomes.reduce((s, i) => (i.day >= a && i.day <= b ? s + i.amount : s), 0));
  }

  function quarterTax(cfg, incomes, y, q) {
    const [s, e] = quarterBounds(y, q);
    const income = sumIncome(incomes, s, e);
    const esv = r2(esvMonth(y) * 3);
    let ep, vz;
    if (cfg.group === 3) {
      ep = r2(income * (cfg.vat ? EP_G3_VAT : EP_G3));
      vz = r2(income * VZ_G3);
    } else {
      const m = cfg.epMonth != null ? cfg.epMonth : epMax(cfg.group, y);
      ep = r2(m * 3);
      vz = r2(vzFixedMonth(y) * 3);
    }
    return { y, q, income, ep, vz, esv, total: r2(ep + vz + esv) };
  }

  function yearTax(cfg, incomes, y) {
    const qs = [1, 2, 3, 4].map((q) => quarterTax(cfg, incomes, y, q));
    const t = { income: 0, ep: 0, vz: 0, esv: 0, total: 0 };
    qs.forEach((x) => Object.keys(t).forEach((k) => (t[k] = r2(t[k] + x[k]))));
    return { quarters: qs, total: t };
  }

  // Річні податки «на папері» для довільного доходу (калькулятор порівняння груп)
  function annualForIncome(group, annualIncome, y, vat) {
    const esv = r2(esvMonth(y) * 12);
    let ep, vz;
    if (group === 3) { ep = r2(annualIncome * (vat ? EP_G3_VAT : EP_G3)); vz = r2(annualIncome * VZ_G3); }
    else { ep = r2(epMax(group, y) * 12); vz = r2(vzFixedMonth(y) * 12); }
    const total = r2(ep + vz + esv);
    return { group, ep, vz, esv, total, net: r2(annualIncome - total),
             overLimit: annualIncome > limit(group, y),
             rate: annualIncome > 0 ? total / annualIncome : 0 };
  }

  // ---- строки ----
  // kind: esv | decl | pay | adv | ydecl
  function deadlines(group, from, to) {
    const out = [];
    for (let y = from.getFullYear() - 1; y <= to.getFullYear(); y++) {
      for (let q = 1; q <= 4; q++) {
        const qEnd = quarterBounds(y, q)[1];
        out.push({ key: `esv-${y}-q${q}`, kind: 'esv', y, q, due: shiftWeekend(addDays(qEnd, 20)),
                   title: `ЄСВ за ${q} квартал ${y}` });
        if (group === 3) {
          out.push({ key: `decl-${y}-q${q}`, kind: 'decl', y, q, due: shiftWeekend(addDays(qEnd, 40)),
                     title: `Декларація за ${q} квартал ${y}` });
          out.push({ key: `pay-${y}-q${q}`, kind: 'pay', y, q, due: shiftWeekend(addDays(qEnd, 50)),
                     title: `Сплата ЄП і ВЗ за ${q} квартал ${y}` });
        }
      }
      if (group === 1 || group === 2) {
        for (let m = 1; m <= 12; m++) {
          out.push({ key: `adv-${y}-${pad(m)}`, kind: 'adv', y, m, due: shiftWeekend(new Date(y, m - 1, 20)),
                     title: `Авансом ЄП і ВЗ за ${pad(m)}.${y}` });
        }
        out.push({ key: `ydecl-${y}`, kind: 'ydecl', y, due: shiftWeekend(addDays(new Date(y, 11, 31), 60)),
                   title: `Річна декларація за ${y}` });
      }
    }
    const a = iso(from), b = iso(to);
    return out.filter((d) => iso(d.due) >= a && iso(d.due) <= b).sort((p, q) => p.due - q.due);
  }

  // Сума до сплати для конкретного строку
  function deadlineAmount(cfg, incomes, d) {
    if (d.kind === 'esv') return r2(esvMonth(d.y) * 3);
    if (d.kind === 'pay') { const t = quarterTax(cfg, incomes, d.y, d.q); return r2(t.ep + t.vz); }
    if (d.kind === 'adv') {
      const m = cfg.epMonth != null ? cfg.epMonth : epMax(cfg.group, d.y);
      return r2(m + vzFixedMonth(d.y));
    }
    return null; // декларації — без суми
  }

  // ---- аналітика ----
  function monthly(incomes, y) {
    const arr = new Array(12).fill(0);
    incomes.forEach((i) => { if (+i.day.slice(0, 4) === y) arr[+i.day.slice(5, 7) - 1] += i.amount; });
    return arr.map(r2);
  }
  function byClient(incomes, y) {
    const m = {};
    incomes.forEach((i) => {
      if (+i.day.slice(0, 4) !== y) return;
      const k = (i.client || '').trim() || 'Без клієнта';
      m[k] = (m[k] || 0) + i.amount;
    });
    return Object.entries(m).map(([name, sum]) => ({ name, sum: r2(sum) })).sort((a, b) => b.sum - a.sum);
  }

  // ---- форматування ----
  function money(x, cur = true) {
    const neg = x < 0; x = Math.abs(x);
    const [w, f] = x.toFixed(2).split('.');
    const s = w.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + f;
    return (neg ? '−' : '') + s + (cur ? ' ₴' : '');
  }
  function moneyShort(x) {
    if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(1).replace('.', ',') + ' млн';
    if (Math.abs(x) >= 1e3) return Math.round(x / 1e3) + ' тис';
    return String(Math.round(x));
  }
  function parseAmount(s) {
    if (s == null) return NaN;
    const t = String(s).replace(/[\s ₴грн]/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
    return +t;
  }

  const Core = { RATES, rates, esvMonth, vzFixedMonth, epMax, limit, iso, parseISO, addDays, daysBetween,
    quarterOf, quarterBounds, shiftWeekend, sumIncome, quarterTax, yearTax, annualForIncome, deadlines,
    deadlineAmount, monthly, byClient, money, moneyShort, parseAmount, EP_G3, EP_G3_VAT, VZ_G3 };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
