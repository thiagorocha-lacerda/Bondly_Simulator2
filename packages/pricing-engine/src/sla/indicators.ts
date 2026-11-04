/**
 * Indicadores de desempenho do SLA técnico (P75/P90) — funções PURAS, sem I/O.
 *
 * Base de cálculo: propostas com SLA CONCLUÍDO. A métrica principal é o TEMPO ÚTIL EFETIVO (dias
 * úteis consumidos, EXCLUINDO pausas — o mesmo `businessDaysElapsed` do `reduceSla`), não o tempo
 * bruto. O tempo BRUTO (início → conclusão, incluindo pausas) é calculado à parte, só para
 * comparação, e deve ser rotulado como "tempo bruto" nas interfaces.
 *
 * ASSUMPTION (reversível): método de percentil = NEAREST-RANK inclusivo —
 *   P(p) = valor na posição ceil(p * n) (base 1) da lista ordenada crescente.
 *   n = 0 → null; n = 1 → o próprio valor; empates não precisam de tratamento especial.
 * Não interpola (interpolação linear daria valores que nenhuma proposta realmente teve).
 * A MEDIANA usa a definição clássica (média dos dois centrais quando n é par) — também ASSUMPTION.
 *
 * NÃO altera `reduceSla`: apenas o consome. Sem custos/margens em nenhum campo (payload gerencial).
 */
import { businessDaysBetween, type Instant, type SpDate } from './businessDays.js';
import { reduceSla, type SlaConfig, type SlaEvent } from './clock.js';

/** Tolerância para evitar erro de ponto flutuante em ceil(p * n) (ex.: 0.9 * 30). */
const EPS = 1e-9;

/**
 * Percentil nearest-rank inclusivo. `p` ∈ (0, 1]. Valores não finitos são ignorados.
 * Retorna null quando não há amostras. Lança RangeError se `p` estiver fora de (0, 1].
 */
export function percentileNearestRank(values: readonly number[], p: number): number | null {
  if (!Number.isFinite(p) || p <= 0 || p > 1) throw new RangeError(`percentil fora de (0,1]: ${p}`);
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  const rank = Math.min(n, Math.max(1, Math.ceil(p * n - EPS)));
  return sorted[rank - 1]!;
}

/** Média aritmética; null se vazio. */
export function mean(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Mediana clássica (média dos dois centrais se n par); null se vazio. */
export function median(values: readonly number[]): number | null {
  const s = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Amostra de uma proposta com SLA concluído. */
export interface SlaSample {
  /** Dias úteis de tempo EFETIVO consumidos (exclui pausas). */
  readonly effectiveBusinessDays: number;
  /** Dias úteis BRUTOS do início à conclusão (inclui pausas). Apenas comparativo. */
  readonly rawBusinessDays: number;
  /** Dias úteis em pausa, por motivo (motivo normalizado por trim). */
  readonly pausedBusinessDaysByReason: Readonly<Record<string, number>>;
}

/**
 * Extrai a amostra de uma sequência de eventos. Retorna null se o SLA não foi iniciado E concluído.
 * Reusa `reduceSla` para o tempo efetivo (fonte única do relógio).
 */
export function sampleFromSlaEvents(events: readonly SlaEvent[], config: SlaConfig): SlaSample | null {
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const started = ordered.find((e) => e.kind === 'started');
  const completed = ordered.find((e) => e.kind === 'completed');
  if (!started || !completed) return null;

  const state = reduceSla(ordered, completed.at, config);
  const rawBusinessDays = businessDaysBetween(started.at, completed.at, config.holidays);

  const byReason: Record<string, number> = {};
  let openPause: { at: Instant; reason: string } | null = null;
  const close = (end: Instant): void => {
    if (!openPause) return;
    const days = businessDaysBetween(openPause.at, end, config.holidays);
    byReason[openPause.reason] = (byReason[openPause.reason] ?? 0) + days;
    openPause = null;
  };
  for (const ev of ordered) {
    if (ev.kind === 'paused') {
      close(ev.at); // pausa sobreposta (defensivo): fecha a anterior
      openPause = { at: ev.at, reason: ev.reason.trim() || '(sem motivo)' };
    } else if (ev.kind === 'resumed' || ev.kind === 'completed') {
      close(ev.at);
    }
  }
  return { effectiveBusinessDays: state.businessDaysElapsed, rawBusinessDays, pausedBusinessDaysByReason: byReason };
}

export interface DistributionStats {
  readonly mean: number | null;
  readonly median: number | null;
  readonly p75: number | null;
  readonly p90: number | null;
}

export interface PauseByReason {
  readonly reason: string;
  /** Total de dias úteis em pausa atribuídos ao motivo (somando todas as propostas). */
  readonly businessDays: number;
  /** Em quantas propostas o motivo apareceu. */
  readonly proposals: number;
}

export interface SlaIndicators {
  /** Nº de propostas com SLA concluído na amostra. */
  readonly n: number;
  /** Prazo de referência em dias úteis (default da config: 5). */
  readonly slaBusinessDays: number;
  /** TEMPO ÚTIL EFETIVO (métrica principal; exclui pausas). */
  readonly effective: DistributionStats;
  /** TEMPO BRUTO (início→conclusão, inclui pausas). Comparativo; sempre rotular como "bruto". */
  readonly raw: DistributionStats;
  /** % (0–100) das propostas com tempo útil efetivo ≤ prazo. null se n = 0. */
  readonly pctWithinSla: number | null;
  /** Tempo em pausa por motivo, ordenado do maior para o menor. */
  readonly pausesByReason: readonly PauseByReason[];
}

function stats(values: readonly number[]): DistributionStats {
  return {
    mean: mean(values),
    median: median(values),
    p75: percentileNearestRank(values, 0.75),
    p90: percentileNearestRank(values, 0.9),
  };
}

/** Agrega as amostras em indicadores. `slaBusinessDays` = limiar de "dentro do prazo". */
export function computeSlaIndicators(allSamples: readonly SlaSample[], slaBusinessDays = 5): SlaIndicators {
  // G-011: amostras inválidas (NaN/∞/negativas) são descartadas ANTES de n/percentis/% no prazo,
  // para que n, pctWithinSla e percentis falem da mesma população.
  const samples = allSamples.filter(
    (s) =>
      Number.isFinite(s.effectiveBusinessDays) &&
      Number.isFinite(s.rawBusinessDays) &&
      s.effectiveBusinessDays >= 0 &&
      s.rawBusinessDays >= 0,
  );
  const eff = samples.map((s) => s.effectiveBusinessDays);
  const raw = samples.map((s) => s.rawBusinessDays);
  const within = eff.filter((v) => v <= slaBusinessDays).length;

  const agg = new Map<string, { days: number; proposals: number }>();
  for (const s of samples) {
    for (const [reason, days] of Object.entries(s.pausedBusinessDaysByReason)) {
      const cur = agg.get(reason) ?? { days: 0, proposals: 0 };
      cur.days += days;
      cur.proposals += 1;
      agg.set(reason, cur);
    }
  }
  const pausesByReason: PauseByReason[] = [...agg.entries()]
    .map(([reason, v]) => ({ reason, businessDays: v.days, proposals: v.proposals }))
    .sort((a, b) => b.businessDays - a.businessDays || a.reason.localeCompare(b.reason));

  return {
    n: samples.length,
    slaBusinessDays,
    effective: stats(eff),
    raw: stats(raw),
    pctWithinSla: samples.length === 0 ? null : (within / samples.length) * 100,
    pausesByReason,
  };
}

/** Conveniência: eventos por proposta → indicadores (ignora propostas sem SLA concluído). */
export function computeSlaIndicatorsFromEvents(
  eventsByProposal: readonly (readonly SlaEvent[])[],
  config: SlaConfig,
): SlaIndicators {
  const samples = eventsByProposal
    .map((evs) => sampleFromSlaEvents(evs, config))
    .filter((s): s is SlaSample => s !== null);
  return computeSlaIndicators(samples, config.businessDays);
}

export type { SpDate };
