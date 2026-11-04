import { describe, it, expect } from 'vitest';
import {
  percentileNearestRank,
  slaMean,
  slaMedian,
  computeSlaIndicators,
  sampleFromSlaEvents,
  computeSlaIndicatorsFromEvents,
  buildHolidaySet,
  defaultSlaConfig,
  type SlaEvent,
  type SlaSample,
} from '../src/index.js';

const at = (s: string): number => Date.parse(s);
const CFG = defaultSlaConfig(buildHolidaySet());
const sample = (eff: number, raw = eff): SlaSample => ({ effectiveBusinessDays: eff, rawBusinessDays: raw, pausedBusinessDaysByReason: {} });

describe('percentileNearestRank (ASSUMPTION: nearest-rank inclusivo, posição ceil(p*n))', () => {
  it('n=0 → null', () => {
    expect(percentileNearestRank([], 0.75)).toBeNull();
    expect(percentileNearestRank([], 0.9)).toBeNull();
  });
  it('n=1 → o próprio valor', () => {
    expect(percentileNearestRank([3], 0.75)).toBe(3);
    expect(percentileNearestRank([3], 0.9)).toBe(3);
  });
  it('10 valores conhecidos 1..10: P75=8 (rank 8), P90=9 (rank 9), independe da ordem de entrada', () => {
    const v = [10, 3, 7, 1, 9, 5, 2, 8, 4, 6];
    expect(percentileNearestRank(v, 0.75)).toBe(8);
    expect(percentileNearestRank(v, 0.9)).toBe(9);
    expect(percentileNearestRank(v, 1)).toBe(10);
  });
  it('não muta a entrada', () => {
    const v = [3, 1, 2];
    percentileNearestRank(v, 0.9);
    expect(v).toEqual([3, 1, 2]);
  });
  it('empates', () => {
    expect(percentileNearestRank([2, 2, 2, 2], 0.75)).toBe(2);
    expect(percentileNearestRank([1, 5, 5, 5, 9], 0.75)).toBe(5); // rank ceil(3.75)=4
    expect(percentileNearestRank([1, 5, 5, 5, 9], 0.9)).toBe(9); // rank ceil(4.5)=5
  });
  it('n=4: P75 = rank 3; n=20: P90 = rank 18 (sem erro de ponto flutuante)', () => {
    expect(percentileNearestRank([1, 2, 3, 4], 0.75)).toBe(3);
    const v20 = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentileNearestRank(v20, 0.9)).toBe(18);
    const v30 = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(percentileNearestRank(v30, 0.9)).toBe(27); // 0.9*30 = 27.000000000000004 em float
  });
  it('p inválido lança; não finitos são ignorados', () => {
    expect(() => percentileNearestRank([1], 0)).toThrow(RangeError);
    expect(() => percentileNearestRank([1], 1.1)).toThrow(RangeError);
    expect(percentileNearestRank([Number.NaN, 4, Number.POSITIVE_INFINITY], 0.9)).toBe(4);
  });
});

describe('média e mediana', () => {
  it('vazio → null; ímpar; par (média dos centrais)', () => {
    expect(slaMean([])).toBeNull();
    expect(slaMedian([])).toBeNull();
    expect(slaMedian([3, 1, 2])).toBe(2);
    expect(slaMedian([1, 2, 3, 4])).toBe(2.5);
    expect(slaMean([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('computeSlaIndicators', () => {
  it('n=0 → tudo null, n=0', () => {
    const r = computeSlaIndicators([]);
    expect(r.n).toBe(0);
    expect(r.effective).toEqual({ mean: null, median: null, p75: null, p90: null });
    expect(r.pctWithinSla).toBeNull();
    expect(r.pausesByReason).toEqual([]);
  });
  it('10 valores 1..10: estatísticas e % dentro de 5 dias úteis (≤5 ⇒ 50%)', () => {
    const r = computeSlaIndicators(Array.from({ length: 10 }, (_, i) => sample(i + 1)));
    expect(r.n).toBe(10);
    expect(r.effective).toEqual({ mean: 5.5, median: 5.5, p75: 8, p90: 9 });
    expect(r.pctWithinSla).toBe(50);
    expect(r.slaBusinessDays).toBe(5);
  });
  it('tempo útil (efetivo) e bruto são métricas distintas', () => {
    const r = computeSlaIndicators([sample(2, 6), sample(3, 3)]);
    expect(r.effective.mean).toBe(2.5);
    expect(r.raw.mean).toBe(4.5);
  });
  it('agrega pausas por motivo (soma de dias, nº de propostas), ordenado desc', () => {
    const a: SlaSample = { effectiveBusinessDays: 2, rawBusinessDays: 5, pausedBusinessDaysByReason: { 'aguardando cliente': 2, 'dúvida escopo': 1 } };
    const b: SlaSample = { effectiveBusinessDays: 1, rawBusinessDays: 4, pausedBusinessDaysByReason: { 'aguardando cliente': 3 } };
    const r = computeSlaIndicators([a, b]);
    expect(r.pausesByReason).toEqual([
      { reason: 'aguardando cliente', businessDays: 5, proposals: 2 },
      { reason: 'dúvida escopo', businessDays: 1, proposals: 1 },
    ]);
  });
  it('payload não contém custo/margem', () => {
    const json = JSON.stringify(computeSlaIndicators([sample(1)]));
    expect(json).not.toMatch(/margin|margem|cost|custo/i);
  });
});

describe('sampleFromSlaEvents — tempo útil efetivo exclui pausas', () => {
  // seg 2027-03-15 → pausa qua 17 → retoma sex 19 → conclui seg 22 (nenhum feriado nacional na semana)
  const evs: SlaEvent[] = [
    { kind: 'started', at: at('2027-03-15T12:00:00-03:00'), by: 'a', briefingVersion: 1 },
    { kind: 'paused', at: at('2027-03-17T12:00:00-03:00'), by: 'a', reason: 'Aguardando cliente ', missingItems: [] },
    { kind: 'resumed', at: at('2027-03-19T12:00:00-03:00'), by: 'a', confirmedItems: [] },
    { kind: 'completed', at: at('2027-03-22T12:00:00-03:00'), by: 'a', verdict: 'aprovado' },
  ];
  it('efetivo < bruto; pausa atribuída ao motivo (trim); efetivo + pausa = bruto', () => {
    const s = sampleFromSlaEvents(evs, CFG)!;
    expect(s).not.toBeNull();
    expect(s.effectiveBusinessDays).toBeLessThan(s.rawBusinessDays);
    const paused = s.pausedBusinessDaysByReason['Aguardando cliente']!;
    expect(paused).toBeGreaterThan(0);
    expect(s.effectiveBusinessDays + paused).toBe(s.rawBusinessDays);
  });
  it('sem conclusão ou sem início → null (fora da amostra)', () => {
    expect(sampleFromSlaEvents(evs.slice(0, 3), CFG)).toBeNull();
    expect(sampleFromSlaEvents(evs.slice(3), CFG)).toBeNull();
  });
  it('computeSlaIndicatorsFromEvents ignora propostas não concluídas', () => {
    const r = computeSlaIndicatorsFromEvents([evs, evs.slice(0, 2), []], CFG);
    expect(r.n).toBe(1);
    expect(r.pausesByReason[0]!.reason).toBe('Aguardando cliente');
  });
});

describe('G-011 — amostras inválidas não contaminam n, % no prazo nem percentis', () => {
  const ok = (e: number, r = e): SlaSample => ({ effectiveBusinessDays: e, rawBusinessDays: r, pausedBusinessDaysByReason: {} });
  it('NaN, Infinity e negativos são descartados', () => {
    const r = computeSlaIndicators([ok(2), ok(4), ok(Number.NaN), ok(-1), ok(Number.POSITIVE_INFINITY), ok(3, Number.NaN)], 5);
    expect(r.n).toBe(2);
    expect(r.pctWithinSla).toBe(100);
    expect(r.effective.p90).toBe(4);
  });
  it('só inválidas ⇒ n=0 e percentis null', () => {
    const r = computeSlaIndicators([ok(-3), ok(Number.NaN)], 5);
    expect(r).toMatchObject({ n: 0, pctWithinSla: null, effective: { p75: null } });
  });
});
