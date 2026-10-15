export interface Theme {
  id: string;
  name: string;
  sky: [string, string];
  ground: string;
  pat: string;
  top: string;
  water: string;
  gen: string;
  p: string;
  /** 地圖重力倍率，乘在 GameBalance 的基礎重力上 */
  grav: number;
  dark?: boolean;
}

export const THEMES: Theme[] = [
  { id: 'grass', name: '青青草原', sky: ['#7cc8ff', '#d9f2ff'], ground: '#b06a35', pat: '#8f5128', top: '#5cc93b', water: '#2f7de1', gen: 'hills', p: 'dots', grav: 1 },
  { id: 'desert', name: '烈日沙漠', sky: ['#ff9f4a', '#ffe3a0'], ground: '#e2a24c', pat: '#c98a38', top: '#f8d77c', water: '#23b5c4', gen: 'dunes', p: 'stripes', grav: 1 },
  { id: 'snow', name: '冰雪山谷', sky: ['#97b8f5', '#eef4ff'], ground: '#7f95bd', pat: '#6b80a8', top: '#ffffff', water: '#4d94dd', gen: 'snow', p: 'rocks', grav: 1 },
  { id: 'volcano', name: '熔岩火山', sky: ['#2a0f2a', '#c4452c'], ground: '#4e3b3b', pat: '#3a2b2b', top: '#ff6a2a', water: '#ff4d1a', gen: 'volcano', p: 'rocks', grav: 1, dark: true },
  { id: 'island', name: '熱帶海島', sky: ['#45c6ff', '#c8f4ff'], ground: '#e8bd76', pat: '#d4a35c', top: '#4fd06a', water: '#14a0d6', gen: 'islands', p: 'dots', grav: 1 },
  { id: 'cave', name: '幽暗洞窟', sky: ['#1f1a2e', '#40334f'], ground: '#7a5a8c', pat: '#64477a', top: '#c69bff', water: '#4a6ad0', gen: 'cave', p: 'rocks', grav: 1, dark: true },
  { id: 'ruins', name: '城市廢墟', sky: ['#8f99ad', '#e6d7c2'], ground: '#7a7674', pat: '#5f5b59', top: '#b8b0a6', water: '#4c6a7a', gen: 'city', p: 'bricks', grav: 1 },
  { id: 'candy', name: '糖果王國', sky: ['#ffb7da', '#fff0f7'], ground: '#ff7fb5', pat: '#fff', top: '#fffaf0', water: '#b07aff', gen: 'candy', p: 'sprinkles', grav: 1 },
  { id: 'forest', name: '迷霧森林', sky: ['#8fdcaa', '#e9fff0'], ground: '#6b4a2a', pat: '#573b20', top: '#2f9a3a', water: '#2a7aa0', gen: 'forest', p: 'dots', grav: 1 },
  { id: 'moon', name: '月球基地', sky: ['#070a22', '#2a2e5c'], ground: '#9a9aac', pat: '#7e7e92', top: '#e2e2ee', water: '#3b3b8a', gen: 'moon', p: 'craters', grav: .45, dark: true },
  { id: 'factory', name: '廢棄工廠', sky: ['#ffc457', '#ffeab8'], ground: '#626b7a', pat: '#4f5766', top: '#ffd23f', water: '#46c46a', gen: 'factory', p: 'hazard', grav: 1 },
  { id: 'station', name: '太空站', sky: ['#080820', '#1d1846'], ground: '#5466a3', pat: '#44558c', top: '#8ae6ff', water: '#3a1f7a', gen: 'station', p: 'panels', grav: .65, dark: true },
];

export interface AnimalStyle { name: string; body: string; belly: string; spike?: string; inner?: string; beak?: string }

export const ANIMALS: Record<string, AnimalStyle> = {
  hamster: { name: '倉鼠', body: '#f2b36b', belly: '#fff1d6' },
  hedgehog: { name: '刺蝟', body: '#c4926a', belly: '#f6dcc0', spike: '#5c3b24' },
  rabbit: { name: '兔子', body: '#f6f1ea', belly: '#ffffff', inner: '#ff9fb8' },
  squirrel: { name: '松鼠', body: '#c96b2c', belly: '#ffe2c2' },
  penguin: { name: '企鵝', body: '#34404f', belly: '#ffffff', beak: '#ffb02e' },
  fox: { name: '狐狸', body: '#ff8a3d', belly: '#ffffff' },
};
