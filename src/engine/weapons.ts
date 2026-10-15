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

export const WEAPONS: WeaponDef[] = [
  { id: 'bazooka', name: '火箭筒', ch: '火', color: '#ff7a1a', charge: 1, ammo: -1, desc: '蓄力發射,受風影響' },
  { id: 'grenade', name: '手榴彈', ch: '榴', color: '#43a047', charge: 1, ammo: -1, desc: '會彈跳,3 秒後爆炸' },
  { id: 'cluster', name: '集束彈', ch: '集', color: '#e94e77', charge: 1, ammo: 3, desc: '爆炸後散出 5 顆子彈' },
  { id: 'shotgun', name: '霰彈槍', ch: '霰', color: '#8d6e63', ammo: -1, desc: '瞬間雙發射擊' },
  { id: 'airstrike', name: '空襲', ch: '空', color: '#3d8bff', target: 1, ammo: 1, desc: '點選位置,5 枚飛彈落下' },
  { id: 'splitter', name: '分裂彈', ch: '裂', color: '#f2a900', charge: 1, ammo: 2, desc: '命中後分裂成 3 顆' },
  { id: 'mine', name: '地雷', ch: '雷', color: '#546e7a', ammo: 2, desc: '放在腳邊,有人靠近就爆' },
  { id: 'dynamite', name: '炸藥', ch: '炸', color: '#d32f2f', ammo: 1, desc: '5 秒後超大爆炸' },
  { id: 'flame', name: '火焰瓶', ch: '焰', color: '#ff5722', charge: 1, ammo: 2, desc: '灑出火焰持續燃燒' },
  { id: 'rope', name: '鉤爪', ch: '鉤', color: '#795548', ammo: -1, desc: '把自己拉過去,不結束回合' },
  { id: 'teleport', name: '傳送', ch: '傳', color: '#8b5cf6', target: 1, ammo: 2, desc: '點選位置瞬間移動' },
  { id: 'homing', name: '追蹤導彈', ch: '導', color: '#00acc1', target: 1, charge: 1, ammo: 2, desc: '先點目標,再蓄力發射' },
  { id: 'drill', name: '鑽地機', ch: '鑽', color: '#607d8b', ammo: 2, desc: '往瞄準方向鑽隧道' },
  { id: 'bat', name: '棒球棍', ch: '棍', color: '#a1887f', ammo: -1, desc: '近戰,把敵人打飛' },
  { id: 'bouncer', name: '跳跳彈', ch: '跳', color: '#ec407a', charge: 1, ammo: 3, desc: '彈跳 7 次後爆炸' },
];

export const WMAP: Record<string, WeaponDef> = {};
WEAPONS.forEach(w => WMAP[w.id] = w);
