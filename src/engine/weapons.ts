// 對外（大廳 UI、window.FurballEngine.WEAPONS）的武器清單，欄位格式與原版相同；
// 數值來源為 config/GameBalance。
import { WEAPONS as BALANCE_LIST, type WeaponBalance } from '../config/GameBalance';

const BALANCE: readonly WeaponBalance[] = BALANCE_LIST;

export interface WeaponDef {
  id: string;
  name: string;
  ch: string;
  color: string;
  charge?: number;
  target?: number;
  ammo: number;
  desc: string;
}

export const WEAPONS: WeaponDef[] = BALANCE.map(b => ({
  id: b.id, name: b.name, ch: b.ch, color: b.color,
  ...(b.target ? { target: 1 } : {}),
  ...(b.charge ? { charge: 1 } : {}),
  ammo: b.ammo, desc: b.desc,
}));

export const WMAP: Record<string, WeaponDef> = {};
WEAPONS.forEach(w => WMAP[w.id] = w);
