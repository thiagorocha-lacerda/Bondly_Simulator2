import { describe, it, expect } from 'vitest';
import { can, canSeeInternal, isRole, type Action } from './rbac.js';

describe('RBAC — decisão pura (§6)', () => {
  it('deny-by-default: papel ausente/inválido nunca autoriza', () => {
    const actions: Action[] = ['proposal.read', 'proposal.see_internal', 'admin.manage_users'];
    for (const a of actions) {
      expect(can(undefined, a)).toBe(false);
      expect(can('nope' as never, a)).toBe(false);
    }
  });

  it('Negócios: edita comercial e desconto por tier, NÃO vê interno nem valida técnico', () => {
    expect(can('business', 'proposal.edit_commercial')).toBe(true);
    expect(can('business', 'proposal.edit_tier_discount')).toBe(true);
    expect(can('business', 'proposal.read')).toBe(true);
    expect(can('business', 'proposal.see_internal')).toBe(false);
    expect(can('business', 'proposal.edit_technical')).toBe(false);
    expect(can('business', 'proposal.validate_technical')).toBe(false);
    expect(can('business', 'admin.manage_users')).toBe(false);
  });

  it('P&T: edita técnico, vê interno e valida; NÃO edita comercial nem administra usuários', () => {
    expect(can('tech', 'proposal.edit_technical')).toBe(true);
    expect(can('tech', 'proposal.see_internal')).toBe(true);
    expect(can('tech', 'proposal.validate_technical')).toBe(true);
    expect(can('tech', 'proposal.read_audit_full')).toBe(true);
    expect(can('tech', 'proposal.edit_commercial')).toBe(false);
    expect(can('tech', 'admin.manage_users')).toBe(false);
  });

  it('Admin administra usuários; os papéis operacionais nunca (§6.1 última linha)', () => {
    expect(can('admin', 'admin.manage_users')).toBe(true);
    expect(can('business', 'admin.manage_users')).toBe(false);
    expect(can('tech', 'admin.manage_users')).toBe(false);
  });

  it('canSeeInternal reflete a linha Negócios×P&T', () => {
    expect(canSeeInternal('business')).toBe(false);
    expect(canSeeInternal('tech')).toBe(true);
    expect(canSeeInternal(undefined)).toBe(false);
  });

  it('isRole valida', () => {
    expect(isRole('business')).toBe(true);
    expect(isRole('tech')).toBe(true);
    expect(isRole('admin')).toBe(true);
    expect(isRole('root')).toBe(false);
    expect(isRole(1)).toBe(false);
  });
});

import { ACTIONS, ROLES, ROLE_LABELS, type Role } from './rbac.js';

/** Matriz esperada EXPLÍCITA (4 perfis × todas as ações). Mudar a matriz exige mudar este teste. */
const EXPECTED: Record<Role, readonly Action[]> = {
  business: ['proposal.create', 'proposal.read', 'proposal.edit_commercial', 'proposal.edit_tier_discount', 'proposal.emit', 'approval.request', 'pricing.quote'],
  tech: [
    'proposal.read',
    'proposal.edit_technical',
    'proposal.see_internal',
    'proposal.validate_technical',
    'proposal.read_audit_full',
    'sla.manage',
    'sla.view_indicators',
    'approval.request',
    'pricing.quote',
  ],
  approver: ['proposal.read', 'proposal.reopen', 'approval.decide', 'approval.read_queue', 'sla.view_indicators', 'pricing.quote'],
  admin: ['proposal.read', 'proposal.reopen', 'proposal.see_internal', 'proposal.read_audit_full', 'sla.manage', 'sla.configure', 'sla.view_indicators', 'admin.manage_users', 'admin.reassign_owner', 'pricing.quote'],
};

describe('RBAC — matriz completa 4 perfis × todas as ações', () => {
  it('são exatamente 4 perfis com rótulos pt-BR', () => {
    expect([...ROLES].sort()).toEqual(['admin', 'approver', 'business', 'tech']);
    expect(ROLE_LABELS).toEqual({
      business: 'Negócios',
      tech: 'Projetos & Tecnologia',
      approver: 'Gestor/Aprovador',
      admin: 'Administrador',
    });
  });
  for (const role of ROLES) {
    for (const action of ACTIONS) {
      const expected = EXPECTED[role].includes(action);
      it(`${role} × ${action} → ${expected ? 'permite' : 'nega'}`, () => {
        expect(can(role, action)).toBe(expected);
      });
    }
  }
  it('G-025 proposal.reopen: só approver/admin; business/tech negados', () => {
    expect(can('approver', 'proposal.reopen')).toBe(true);
    expect(can('admin', 'proposal.reopen')).toBe(true);
    expect(can('business', 'proposal.reopen')).toBe(false);
    expect(can('tech', 'proposal.reopen')).toBe(false);
    expect(can(undefined, 'proposal.reopen')).toBe(false);
  });
  it('approver NÃO edita dimensionamento técnico nem configuração; business sem custo/margem', () => {
    expect(can('approver', 'proposal.edit_technical')).toBe(false);
    expect(can('approver', 'sla.configure')).toBe(false);
    expect(can('approver', 'admin.manage_users')).toBe(false);
    expect(can('business', 'sla.view_indicators')).toBe(false);
    expect(canSeeInternal('business')).toBe(false);
    expect(canSeeInternal('approver')).toBe(false);
  });
});
