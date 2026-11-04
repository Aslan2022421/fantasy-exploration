// 第三十五版：裝備包、消耗品、陷阱與門鎖的場景測試
function testGear35() {
  const ok = (cond, msg) => { gearChecks++; if (!cond) fail('第三十五版裝備 ' + msg); };
  const g = new FE.Game(3535);
  g.start();
  g.checkCreate = () => {};
  g.monsters = [];
  g.endTurn = () => {};

  const oldClasses = FE.CLASSES;
  const oldMastery = FE.MASTERY_SKILL;
  useClasses('new');
  const picks = FE.Char.defaultPicks('warrior', 70000);
  picks[picks.length - 1] = 'pack_supply';
  const starter = FE.Char.create(g, 'warrior', picks, '測試者');
  ok(starter.bag.some((e) => e.id === 'herb' && e.n === 2) && starter.bag.some((e) => e.id === 'potion' && e.n === 1), '建角補給包沒有放入藥草與治療藥水');
  const archer = FE.Char.create(g, 'warrior', FE.Char.defaultPicks('warrior', 70000).slice(0, -1).concat('pack_archer'), '測試者');
  ok(archer.bag.some((e) => e.id === 'arrow' && e.n === 20) && archer.bag.some((e) => e.id === 'bolt' && e.n === 20), '建角射手包沒有放入兩種彈藥');
  FE.CLASSES = oldClasses;
  FE.MASTERY_SKILL = oldMastery;

  const village = g.world.villages.find((v) => v.kind === 'village');
  const smith = g.world.npcs.find((n) => n.villageId === village.id && n.role === 'smith');
  const p = g.player;
  p.copper = 100000;
  const packPrice = FE.Gear.shopPrice('pack_supply', 0, village, g.chaMod());
  ok(shopDo(g, smith, 'buyItem:pack_supply:0') && p.copper === 100000 - packPrice && g.bagCount('herb') === 2 && g.bagCount('potion') === 1, '商店沒有正確販售並拆開補給包');
  ok(FE.Gear.shopPrice('dart', 0) === 1 && FE.Gear.shopPrice('woodclub', 0) === 2 && FE.Gear.shopPrice('greatclub', 0) === 4 && FE.Gear.shopPrice('slingBullet', 0) === 1 && FE.Gear.shopPrice('oil', 0) === 2, '新物品價格沒有依 SRD 相對價換算，或低價物品被四捨五入成免費');
  ok(['lance', 'musket', 'pistol', 'blowgun'].every((id) => FE.GEAR[id].sold && FE.GEAR[id].drop) && FE.Gear.SHOPS.weaponsmith.buy.pole.includes('lance') && ['musket', 'pistol', 'blowgun', 'bullet', 'needle'].every((id) => FE.Gear.SHOPS.weaponsmith.buy.ranged.includes(id)), '騎槍、火器、吹箭筒或其彈藥沒有接上商店與掉落');

  const oldRng = g.rng;
  const oldRollD20 = FE.rollD20;
  const oldHook = FE.Combat.hook;
  g.rng = () => 0;
  FE.rollD20 = (rng, mod, adv, critMin, ac) => ({ n: 10, dice: [10], adv: 0, mod: mod || 0, total: 10 + (mod || 0), ac, key: 'hit', name: '命中' });
  let spot = null;
  const bounds = g.world.bounds();
  for (let y = bounds.y0 + 1; y < bounds.y1 - 1 && !spot; y++) {
    for (let x = bounds.x0 + 1; x < bounds.x1 - 1 && !spot; x++) {
      if (g.world.passable(x, y) && g.world.passable(x + 1, y) && !g.world.inVillage(x, y) && !g.world.inBuffer(x, y) && g.world.heightOk(x, y, x + 1, y)) spot = { x, y };
    }
  }
  ok(!!spot, '找不到測試用的野外空地');
  if (!spot) {
    g.rng = oldRng;
    FE.rollD20 = oldRollD20;
    FE.Combat.hook = oldHook;
    return;
  }
  p.x = spot.x;
  p.y = spot.y;
  const makeTarget = (id, x, race) => {
    const m = FE.dressMonster(FE.makeMonster({ type: 'TERRAIN', x, y: spot.y, cells: [[x, spot.y]], scope: 2, data: {} }, id, 1), g.world);
    Object.assign(m, { race: race || m.race, maxHp: 10000, hp: 10000, ac: 1 });
    g.monsters = [m];
    return m;
  };
  for (const [weapon, ammo, field] of [['musket', 'bullet', 'bullets'], ['pistol', 'bullet', 'bullets'], ['blowgun', 'needle', 'needles']]) {
    p.equip.main = FE.Gear.make(weapon, 0);
    g.bagAdd(ammo, 2, { q: 0 });
    const shotTarget = makeTarget(81000 + ['musket', 'pistol', 'blowgun'].indexOf(weapon), spot.x + 1);
    g.fireAt(shotTarget, 'shoot');
    g.fireAt(shotTarget, 'shoot');
    g.recoverArrows(shotTarget);
    ok(g.bagCount(ammo) === 1 && shotTarget[field] === null, `${FE.GEAR[weapon].name}沒有消耗或回收${FE.GEAR[ammo].name}`);
    g.bagTake(ammo, 1, 0);
  }
  p.equip.main = null;
  const target = makeTarget(80001, spot.x + 1);
  let itemEvent = null;
  FE.Combat.hook = (e) => { if (e.mode === 'item') itemEvent = e; };
  g.bagAdd('acid', 1);
  const acid = g.fireAt(target, 'item:acid');
  ok(acid && itemEvent && itemEvent.dmg === 2 && g.bagCount('acid') === 0, '酸液沒有消耗或依 2d6 造成傷害');

  const fireTarget = makeTarget(80002, spot.x + 1);
  itemEvent = null;
  g.bagAdd('alchemistFire', 1);
  const fire = g.fireAt(fireTarget, 'item:alchemistFire');
  ok(fire && itemEvent && itemEvent.dmg === 1 && fireTarget.burning === C.BURN_TURNS, '鍊金術士之火命中後沒有附加燃燒');

  const undead = makeTarget(80003, spot.x + 1, 'skeleton');
  itemEvent = null;
  g.bagAdd('holyWater', 1);
  const holy = g.fireAt(undead, 'item:holyWater');
  ok(holy && itemEvent && itemEvent.dmg === 2 && g.bagCount('holyWater') === 0, '聖水沒有對不死怪物造成 2d8 神聖傷害');
  const living = makeTarget(80005, spot.x + 1, 'goblin');
  itemEvent = null;
  g.bagAdd('holyWater', 1);
  g.fireAt(living, 'item:holyWater');
  ok(!itemEvent && g.bagCount('holyWater') === 0, '聖水對非不死怪物沒有消耗或錯誤造成傷害');
  const oilTarget = makeTarget(80006, spot.x + 1);
  itemEvent = null;
  g.bagAdd('oil', 1);
  g.fireAt(oilTarget, 'item:oil');
  ok(itemEvent && itemEvent.dmg === 5 && g.bagCount('oil') === 0, '燈油沒有造成固定 5 點火焰傷害');

  p.hp = 1;
  g.bagAdd('potion', 1);
  g.useItem(g.player.bag.findIndex((e) => e.id === 'potion'));
  ok(p.hp === 5 && g.bagCount('potion') === 1, '治療藥水沒有回復 2d4＋2 生命或消耗一瓶');

  p.x = spot.x;
  p.y = spot.y;
  g.bagAdd('caltrops', 1);
  g.useItem(g.player.bag.findIndex((e) => e.id === 'caltrops'));
  const trap = g.world.items.find((it) => it.trap === 'caltrops');
  const trapped = makeTarget(80004, spot.x, 'goblin');
  const trapHp = trapped.hp;
  g.triggerTrap(trapped, spot.x, spot.y);
  ok(trap && !trap.armed && trapped.hp === trapHp - 1 && trapped.slowed > 0, '鐵蒺藜沒有觸發傷害與緩速');
  g.pickUp(spot.x, spot.y);
  ok(!g.world.items.some((it) => it.trap === 'caltrops') && g.bagCount('caltrops') === 1, '已觸發陷阱不能收回');
  g.bagAdd('bearings', 1);
  g.useItem(g.player.bag.findIndex((e) => e.id === 'bearings'));
  const bearingsTarget = makeTarget(80007, spot.x, 'goblin');
  g.triggerTrap(bearingsTarget, spot.x, spot.y);
  ok(bearingsTarget.prone && bearingsTarget.hp === 10000, '滾珠沒有使怪物摔倒');
  g.pickUp(spot.x, spot.y);
  g.bagAdd('huntingTrap', 1);
  g.useItem(g.player.bag.findIndex((e) => e.id === 'huntingTrap'));
  const huntingTarget = makeTarget(80008, spot.x, 'goblin');
  g.triggerTrap(huntingTarget, spot.x, spot.y);
  ok(huntingTarget.prone && huntingTarget.slowed === 2 && huntingTarget.hp === 9999, '捕獸夾沒有造成傷害、倒地與緩速');

  const door = { x: spot.x + 1, y: spot.y };
  g.world.cell(door.x, door.y).t = '+';
  g.bagAdd('lock', 1);
  g.useItem(g.player.bag.findIndex((e) => e.id === 'lock'));
  ok(g.world.isLocked(door.x, door.y) && !g.world.canStep(spot.x, spot.y, door.x, door.y) && g.bagCount('lock') === 0, '門鎖沒有阻擋通行或消耗門鎖');
  g.bagAdd('crowbar', 1);
  g.rng = () => 0.999;
  g.useItem(g.player.bag.findIndex((e) => e.id === 'crowbar'));
  ok(!g.world.isLocked(door.x, door.y) && g.world.canStep(spot.x, spot.y, door.x, door.y) && g.bagCount('crowbar') === 1, '撬棍沒有開鎖，或被錯誤消耗');
  g.world.lockDoor(door.x, door.y);
  g.bagAdd('thievesTools', 1);
  g.useItem(g.player.bag.findIndex((e) => e.id === 'thievesTools'));
  ok(!g.world.isLocked(door.x, door.y) && g.bagCount('thievesTools') === 1, '盜賊工具不能開鎖，或被錯誤消耗');

  const saveDoor = { x: door.x, y: door.y };
  g.world.lockDoor(saveDoor.x, saveDoor.y);
  g.world.items.push({ x: spot.x, y: spot.y, trap: 'bearings', armed: true });
  g.rng = oldRng;
  FE.Save.save(g);
  let loaded = FE.Save.load();
  ok(loaded && loaded.game.world.isLocked(saveDoor.x, saveDoor.y) && loaded.game.world.items.some((it) => it.trap === 'bearings' && it.armed), '存檔讀回沒有保留門鎖與陷阱');
  const saved = FE.store.load('fe.save');
  delete saved.data.world.locks;
  FE.store.save('fe.save', saved);
  loaded = FE.Save.load();
  ok(loaded && Array.isArray(loaded.game.world.locks) && loaded.game.world.locks.length === 0, '舊存檔沒有 locks 欄位時無法正常讀取');

  FE.rollD20 = oldRollD20;
  FE.Combat.hook = oldHook;
}

UNITS.gear35 = testGear35;
