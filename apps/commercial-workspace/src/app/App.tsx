import { useEffect, useRef, useState } from 'react';
import type { ModuleId } from '@bondly/pricing-types';
import { MODULE_CATALOG, validateDependencies } from '@bondly/pricing-catalog';
import { useCentralPricing } from '../services/pricing/useCentralPricing';
import { useTheme } from '../hooks/useTheme';
import { useB2c } from '../hooks/useB2c';
import { useSession } from '../hooks/useSession';
import { useAudience } from './audience';
import { QuickMode } from '../components/QuickMode';
import { AdvancedMode } from '../components/AdvancedMode';
import { ResultsDashboard } from '../components/ResultsDashboard';
import { PreviewModal } from '../components/PreviewModal';
import { ServicesPanel } from '../components/ServicesPanel';
import { CampaignPanel } from '../components/CampaignPanel';
import { B2cPanel } from '../components/B2cPanel';
import { ArkaPanel } from '../components/ArkaPanel';
import { ScenarioPanel } from '../components/ScenarioPanel';
import { TierDiscountPanel } from '../components/TierDiscountPanel';
import { SetupPanel } from '../components/SetupPanel';
import { ProfileGate } from '../components/ProfileGate';
import { WorkflowStepper } from '../components/WorkflowStepper';
import { useProposals } from '../hooks/useProposals';
import { UserMenu } from '../components/UserMenu';
import { AssignmentsAdmin } from '../components/AssignmentsAdmin';
import { ApproverQueue } from '../components/ApprovalPanels';
import { ROLE_LABELS } from '../hooks/roles';

type Mode = 'quick' | 'advanced';

const MODULES_KEY = 'bondly-ws-modules';
function loadModules(): ModuleId[] {
  try {
    const raw = localStorage.getItem(MODULES_KEY);
    return raw ? (JSON.parse(raw) as ModuleId[]) : ['points', 'engagement'];
  } catch {
    return ['points', 'engagement'];
  }
}

export function App() {
  // G-001-A Fase 3.2: origem do cálculo comutável por flag de runtime (?pricingSource=server).
  // Default 'local' ⇒ engine no navegador, comportamento idêntico ao atual. 'server' ⇒ POST /api/pricing/quote.
  const { input, result, update, reset } = useCentralPricing();
  const [theme, setTheme] = useTheme();
  const b2c = useB2c();
  const { audience, internal, setAudience } = useAudience();
  const { user, loading, unlock } = useSession();
  const role = user?.role ?? null;
  // A esteira só opera com papel desbloqueado; o hook fica ocioso sem papel ou sem BFF.
  const proposals = useProposals(role !== null);
  const [mode, setMode] = useState<Mode>('quick');
  const [preview, setPreview] = useState(false);
  const [modules, setModulesState] = useState<ModuleId[]>(loadModules);

  const setModules = (ids: ModuleId[]) => {
    setModulesState(ids);
    try {
      localStorage.setItem(MODULES_KEY, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
    // a contagem de módulos selecionados alimenta o score de complexidade (R-011 / D-M1)
    update({ complexity: { modules: Math.max(1, ids.length) } });
  };

  // Fonte única também no BOOT: se a contagem salva no input divergir da seleção de módulos
  // persistida, a seleção vence (é a UI canônica). Evita cálculo com contagem defasada antes
  // do primeiro clique. Só dispara quando realmente diverge.
  useEffect(() => {
    const expected = Math.max(1, modules.length);
    if (input.complexity.modules !== expected) {
      update({ complexity: { modules: expected } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAll = () => {
    reset();
    b2c.reset();
    setModulesState(['points', 'engagement']);
    try {
      localStorage.setItem(MODULES_KEY, JSON.stringify(['points', 'engagement']));
    } catch {
      /* ignore */
    }
  };

  const depIssues = validateDependencies(modules).filter((i) => i.kind === 'required');

  // Indicador "salvo automaticamente": pulsa brevemente quando algo persistível muda.
  // Pula o primeiro render (boot) para não piscar sem ação do usuário.
  const [savedPulse, setSavedPulse] = useState(false);
  const bootDone = useRef(false);
  useEffect(() => {
    if (!bootDone.current) {
      bootDone.current = true;
      return;
    }
    setSavedPulse(true);
    const id = window.setTimeout(() => setSavedPulse(false), 1600);
    return () => window.clearTimeout(id);
  }, [input, b2c.raw, b2c.enabled, b2c.include, modules]);

  // Papel business nunca fica em visão interna (§6.2). Aplica assim que o papel é conhecido.
  useEffect(() => {
    if ((role === 'business' || role === 'approver') && audience === 'internal') setAudience('external');
  }, [role, audience, setAudience]);

  // 2º fator (§7.2): havendo sessão Google SEM papel, exige o código de perfil antes de qualquer
  // conteúdo. Em dev sem BFF (user=null) não bloqueia — o simulador segue utilizável.
  if (user && role === null && !loading) {
    return <ProfileGate email={user.email} onUnlock={unlock} legacyEnabled={user.legacyProfileCodes === true} />;
  }

  // Papel business só enxerga a visão comercial (§6.2): custos/margens ficam fora por construção.
  // A fronteira REAL é o servidor (APIs filtradas por papel); aqui alinhamos a UI ao papel.
  const forcedExternal = role === 'business' || role === 'approver';
  const showInternal = internal && !forcedExternal;
  const effectiveMode: Mode = showInternal ? mode : 'quick';

  return (
    <div className="wrap">
      <header className="app">
        <div>
          <div className="brand">
            BONDLY <span>· COMMERCIAL WORKSPACE</span>
          </div>
          <div className="meta">Pricing Engine {result.engineVersion} · premissas {result.premisesVersion} · {result.premisesHash}</div>
        </div>
        <div className="headerright">
          <UserMenu user={user} />
          <div className="toggle" role="group" aria-label="Tema">
            <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Claro</button>
            <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Escuro</button>
          </div>
        </div>
      </header>

      <div className="stepper">
        {showInternal && (
          <div className="modetabs" role="tablist" aria-label="Modo de configuração">
            <button type="button" role="tab" aria-selected={mode === 'quick'} aria-current={mode === 'quick' ? 'step' : undefined} onClick={() => setMode('quick')}>
              Modo rápido
            </button>
            <button type="button" role="tab" aria-selected={mode === 'advanced'} aria-current={mode === 'advanced' ? 'step' : undefined} onClick={() => setMode('advanced')}>
              Modo avançado
            </button>
          </div>
        )}
        {showInternal && <span style={{ flex: 1 }} />}
        <div className="audienceswitch" role="group" aria-label="Visão (o que aparece na tela)">
          <span className="switchlabel" title="A visão comercial oculta custos, margens e dados internos — segura para mostrar ao cliente.">Visão:</span>
          <button type="button" aria-pressed={audience === 'internal'} disabled={forcedExternal} title={forcedExternal && role ? `Perfil ${ROLE_LABELS[role]}: visão comercial apenas.` : undefined} onClick={() => setAudience('internal')}>
            Interna
          </button>
          <button type="button" aria-pressed={audience === 'external'} title="Oculta custos, margens, ARKA e resultado B2C/Minu — segura para o cliente." onClick={() => setAudience('external')}>
            Comercial
          </button>
        </div>
      </div>

      {depIssues.length > 0 && (
        <div className="note bad" role="alert">
          Dependências de módulos pendentes:{' '}
          {depIssues
            .map((i) => `${MODULE_CATALOG.find((m) => m.id === i.module)?.name} requer ${MODULE_CATALOG.find((m) => m.id === i.missing)?.name}`)
            .join('; ')}
          .
        </div>
      )}

      <div className="grid">
        <div>
          {effectiveMode === 'quick' ? (
            <QuickMode input={input} update={update} selectedModules={modules} onModules={setModules} />
          ) : (
            <>
              <AdvancedMode input={input} update={update} selectedModules={modules} onModules={setModules} />
              {showInternal && (
                <>
                  <div style={{ height: 16 }} />
                  <ServicesPanel input={input} update={update} />
                  <div style={{ height: 16 }} />
                  <CampaignPanel input={input} update={update} />
                </>
              )}
            </>
          )}

          {/* Descontos por tier (§3.1) — condição comercial, visível em ambos os modos. */}
          <div style={{ height: 16 }} />
          <TierDiscountPanel input={input} result={result} update={update} />

          {/* Setup redesenhado (§4) — fixo configurável + horas + outros, visível em ambos os modos. */}
          <div style={{ height: 16 }} />
          <SetupPanel input={input} result={result} update={update} internal={showInternal} />

          {/* Módulo de vendas Assinaturas B2C — habilitável em AMBOS os modos. */}
          <div style={{ height: 16 }} />
          <B2cPanel
            input={b2c.input}
            enabled={b2c.enabled}
            include={b2c.include}
            set={b2c.set}
            setEnabled={b2c.setEnabled}
            setInclude={b2c.setInclude}
          />
          <p className="sub" style={{ marginTop: 14 }}>
            Armazenamento local (Cenário A): os dados ficam só neste navegador, não sincronizados entre usuários ou dispositivos.
          </p>
        </div>

        <div className="result-col">
          <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div className="actions" style={{ margin: 0 }}>
              <button className="cta" type="button" onClick={() => setPreview(true)}>
                Pré-visualizar → gerar PDF
              </button>
              <button className="ghostbtn" type="button" onClick={resetAll}>
                Voltar aos padrões
              </button>
            </div>
            <span className={`saved-tag ${savedPulse ? 'show' : ''}`} role="status" aria-live="polite">
              {savedPulse ? 'Salvo automaticamente' : ''}
            </span>
          </div>
          <ResultsDashboard result={result} users={input.volume.users} />
          {showInternal && <ArkaPanel input={input} />}
          {role && <WorkflowStepper role={role} proposals={proposals} />}
          {role === 'approver' && <ApproverQueue enabled={proposals.available} />}
          {role === 'admin' && <AssignmentsAdmin />}
          <ScenarioPanel input={input} />
        </div>
      </div>

      {preview && <PreviewModal input={input} b2cInput={b2c.enabled && b2c.include ? b2c.input : undefined} selectedModules={modules} onClose={() => setPreview(false)} />}
    </div>
  );
}
