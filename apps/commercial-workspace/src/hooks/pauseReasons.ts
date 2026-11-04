/**
 * Catálogo FECHADO de motivos de pausa do SLA (G-017). Espelha PAUSE_REASON_LABELS de
 * apps/auth-proxy/src/limits.ts (fonte de verdade = servidor; o teste de sincronia do auth-proxy
 * quebra se divergirem). O `reasonCode` é a única dimensão agregada em /api/sla/indicators.
 */
export const PAUSE_REASONS: readonly { code: string; label: string }[] = [
  { code: 'aguardando_cliente', label: 'Aguardando cliente' },
  { code: 'aguardando_insumos_tecnicos', label: 'Aguardando insumos técnicos' },
  { code: 'aguardando_reuniao_tecnica', label: 'Aguardando reunião técnica' },
  { code: 'escopo_indefinido', label: 'Escopo indefinido' },
  { code: 'dependencia_externa', label: 'Dependência externa' },
  { code: 'outro', label: 'Outro' },
];
/** Limite do texto livre (espelha MAX_PAUSE_REASON_CHARS do servidor). */
export const MAX_PAUSE_REASON_CHARS = 200;
