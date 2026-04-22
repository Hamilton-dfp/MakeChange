const GAME_WIDTH = 540;
const GAME_HEIGHT = 960;
const SLOT_COUNT = 15;
const UNLOCKED_COUNT = 7;
const SLOT_CAPACITY = 10;
const MAX_DENOM = 15;
const STARTING_MAX_DEAL_DENOM = 5;
const DENOMINATIONS = Array.from({ length: MAX_DENOM }, (_, i) => i + 1);

const COIN_COLORS = createDenominationColors();

const SLOT_UNLOCK_COST_BY_ORDER = [5, 10, 20, 30, 50, 80, 130, 200];


function createDenominationColors() {
  const colors = {};
  for (let d = 1; d <= MAX_DENOM; d += 1) {
    const hue = Math.floor(((d - 1) / MAX_DENOM) * 360);
    const color = Phaser.Display.Color.HSLToColor(hue / 360, 0.72, 0.58);
    colors[d] = Phaser.Display.Color.GetColor(color.red, color.green, color.blue);
  }
  return colors;
}

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#26140f',
  parent: 'game-root',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: {
    create,
  },
};

new Phaser.Game(config);

function create() {
  this.state = {
    slots: [],
    credits: 0,
    selected: null,
    busy: false,
    gameOver: false,
    won: false,
    maxDealDenom: STARTING_MAX_DEAL_DENOM,
  };

  this.coinRadius = 12;
  this.slotW = 78;
  this.slotH = 188;
  this.stackStep = 17;
  this.boardRows = 3;
  this.boardCols = 5;
  this.boardX = 36;
  this.boardY = 160;
  this.boardW = GAME_WIDTH - 72;
  this.boardH = 640;

  drawBackground.call(this);
  createAudio.call(this);
  createUI.call(this);
  createBoard.call(this);
  seedInitialBoard.call(this);
  refreshAllSlots.call(this);
  refreshHud.call(this);
}

function drawBackground() {
  const g = this.add.graphics();
  g.fillGradientStyle(0x5d2f1f, 0x4d2518, 0x32180f, 0x28140d, 1);
  g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  const board = this.add.graphics();
  board.fillStyle(0x8b471f, 1);
  board.fillRoundedRect(this.boardX, this.boardY, this.boardW, this.boardH, 22);
  board.lineStyle(6, 0xc07a41, 0.9);
  board.strokeRoundedRect(this.boardX, this.boardY, this.boardW, this.boardH, 22);
}

function createAudio() {
  this.soundFx = {
    play: (kind) => {
      const context = this.sound.context;
      if (!context) return;
      const now = context.currentTime;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.connect(gain);
      gain.connect(context.destination);

      const profiles = {
        move: [520, 0.03, 'square'],
        place: [420, 0.04, 'triangle'],
        merge: [740, 0.08, 'sawtooth'],
        click: [300, 0.03, 'square'],
        invalid: [180, 0.06, 'sine'],
      };

      const [frequency, duration, wave] = profiles[kind] || profiles.click;
      osc.type = wave;
      osc.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    },
  };
}

function createUI() {
  this.creditText = this.add.text(GAME_WIDTH - 24, 36, 'Credits: 0', {
    fontSize: '30px',
    color: '#fff4cc',
    stroke: '#000000',
    strokeThickness: 5,
  }).setOrigin(1, 0);

  const buttonY = GAME_HEIGHT - 84;
  const dealBg = this.add.rectangle(GAME_WIDTH / 2, buttonY, 260, 76, 0x52bb2c, 1)
    .setStrokeStyle(5, 0xbbf78f)
    .setInteractive({ useHandCursor: true });
  const dealText = this.add.text(GAME_WIDTH / 2, buttonY, 'Deal', {
    fontSize: '40px',
    color: '#ffffff',
    fontStyle: 'bold',
    stroke: '#000000',
    strokeThickness: 6,
  }).setOrigin(0.5);

  this.dealButton = this.add.container(0, 0, [dealBg, dealText]);
  dealBg.on('pointerdown', async () => {
    if (this.state.gameOver) return;
    this.soundFx.play('click');
    await runDeal.call(this);
    checkLoss.call(this);
  });
}

function createBoard() {
  const padX = 26;
  const padY = 26;
  const startX = this.boardX + padX;
  const startY = this.boardY + padY;
  const gapX = 82;
  const gapY = 196;

  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const row = Math.floor(i / this.boardCols);
    const col = i % this.boardCols;
    const x = startX + col * gapX;
    const y = startY + row * gapY;

    const slotBg = this.add.rectangle(x, y, this.slotW, this.slotH, 0x5f2d15, 0.85)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x9f5b31, 0.8)
      .setInteractive({ useHandCursor: true });

    const unlockOrder = ((this.boardRows - 1 - row) * this.boardCols + col);
    const unlocked = unlockOrder < UNLOCKED_COUNT;
    const lockLabel = this.add.text(x + this.slotW / 2, y + this.slotH / 2, 'LOCKED', {
      fontSize: '18px',
      color: '#ffdd99',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setVisible(!unlocked);

    const coinsLayer = this.add.container(0, 0).setDepth(25);
    slotBg.setDepth(10);
    lockLabel.setDepth(15);

    const slot = {
      id: i,
      unlocked,
      capacity: SLOT_CAPACITY,
      coins: [],
      visuals: [],
      x,
      y,
      bg: slotBg,
      lockLabel,
      layer: coinsLayer,
      unlockCost: unlocked ? 0 : SLOT_UNLOCK_COST_BY_ORDER[unlockOrder - UNLOCKED_COUNT] ?? 0,
      unlockButton: null,
    };

    if (!unlocked) {
      const btnY = y + this.slotH - 34;
      const btnBg = this.add.rectangle(x + this.slotW / 2, btnY, this.slotW - 12, 30, 0x6a4a2a, 0.9)
        .setStrokeStyle(2, 0xcaa16a)
        .setInteractive({ useHandCursor: true })
        .setDepth(16);
      const btnText = this.add.text(x + this.slotW / 2, btnY, `Unlock ${slot.unlockCost}`, {
        fontSize: '11px',
        color: '#fff7d1',
        stroke: '#000',
        strokeThickness: 3,
      }).setOrigin(0.5).setDepth(17);
      btnBg.on('pointerdown', () => tryUnlockSlot.call(this, slot.id));
      slot.unlockButton = { bg: btnBg, text: btnText };
    }

    slotBg.on('pointerdown', () => onSlotTapped.call(this, slot.id));
    this.state.slots.push(slot);
  }
}

function seedInitialBoard() {
  this.state.slots.forEach((slot) => {
    if (!slot.unlocked) return;
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const denom = Phaser.Math.Between(1, STARTING_MAX_DEAL_DENOM);
      const addCount = Phaser.Math.Between(0, 5);
      for (let j = 0; j < addCount && slot.coins.length < SLOT_CAPACITY; j += 1) {
        slot.coins.push(denom);
      }
    }
  });
}

async function onSlotTapped(slotId) {
  if (this.state.gameOver) return;

  const slot = this.state.slots[slotId];
  if (!slot.unlocked) {
    tryUnlockSlot.call(this, slot.id);
    return;
  }

  if (!this.state.selected) {
    const pick = getTopGroup(slot);
    if (!pick) return;
    this.state.selected = { slotId, denom: pick.denom, count: pick.count };
    this.soundFx.play('click');
    updateSelectionVisuals.call(this);
    return;
  }

  if (this.state.selected.slotId === slotId) {
    this.state.selected = null;
    updateSelectionVisuals.call(this);
    return;
  }

  const source = this.state.slots[this.state.selected.slotId];
  const target = slot;
  const canMove = isMoveValid(source, target, this.state.selected.denom);

  if (!canMove) {
    pulseSlot.call(this, target, 0xff4040);
    this.soundFx.play('invalid');
    return;
  }

  const movable = Math.min(this.state.selected.count, SLOT_CAPACITY - target.coins.length);
  if (movable <= 0) {
    pulseSlot.call(this, target, 0xff4040);
    this.soundFx.play('invalid');
    return;
  }

  await moveCoinsAnimated.call(this, source, target, movable);
  this.state.selected = null;
  updateSelectionVisuals.call(this);

  let merged = true;
  while (merged) {
    merged = await resolveAllMerges.call(this);
  }

  checkLoss.call(this);
}

function getTopGroup(slot) {
  if (!slot.coins.length) return null;
  const denom = slot.coins[slot.coins.length - 1];
  let count = 0;
  for (let i = slot.coins.length - 1; i >= 0; i -= 1) {
    if (slot.coins[i] === denom) count += 1;
    else break;
  }
  return { denom, count };
}

function isMoveValid(source, target, denom) {
  if (!target.unlocked || source.id === target.id || !source.coins.length) return false;
  if (!target.coins.length) return true;
  return target.coins[target.coins.length - 1] === denom;
}

function updateSelectionVisuals() {
  this.state.slots.forEach((slot) => {
    slot.bg.setStrokeStyle(2, 0x9f5b31, 0.8);
    slot.visuals = slot.visuals.filter((coin) => coin && coin.active && coin.ring && coin.body);
    slot.visuals.forEach((coin) => {
      coin.y = coin.baseY;
      coin.setScale(1);
      coin.ring.setFillStyle(0xffffff, 1);
      coin.body.setStrokeStyle(2, 0xffffff, 0.3);
    });
  });

  if (!this.state.selected) return;
  const slot = this.state.slots[this.state.selected.slotId];
  if (!slot) return;
  slot.bg.setStrokeStyle(5, 0xfff37a, 1);
  const n = Math.min(this.state.selected.count, slot.visuals.length);
  for (let i = slot.visuals.length - n; i < slot.visuals.length; i += 1) {
    const coin = slot.visuals[i];
    if (!coin) continue;
    coin.y = coin.baseY - 10;
    coin.ring.setFillStyle(0xffef9f, 1);
    coin.body.setStrokeStyle(4, 0xfff7ba, 1);
  }
}

function makeCoinVisual(scene, denom, x, y) {
  const container = scene.add.container(x, y);
  const ring = scene.add.circle(0, 0, scene.coinRadius + 2, 0xffffff, 1);
  const body = scene.add.circle(0, 0, scene.coinRadius, COIN_COLORS[denom], 1);
  body.setStrokeStyle(2, 0xffffff, 0.3);
  const txt = scene.add.text(0, 0, String(denom), {
    fontSize: '20px',
    fontStyle: 'bold',
    color: '#1a1a1a',
    stroke: '#ffffff',
    strokeThickness: 2,
  }).setOrigin(0.5);

  container.add([ring, body, txt]);
  container.baseY = y;
  container.ring = ring;
  container.body = body;
  container.selected = false;
  return container;
}

function clearVisuals(slot) {
  slot.visuals.forEach((v) => v.destroy());
  slot.visuals = [];
}

function refreshAllSlots() {
  this.state.slots.forEach((slot) => {
    clearVisuals(slot);
    for (let i = 0; i < slot.coins.length; i += 1) {
      const denom = slot.coins[i];
      const targetY = slot.y + (this.coinRadius + 6) + i * this.stackStep;
      const targetX = slot.x + this.slotW / 2;
      const v = makeCoinVisual(this, denom, targetX, targetY);
      slot.layer.add(v);
      slot.visuals.push(v);
    }
  });
  updateSelectionVisuals.call(this);
  refreshHud.call(this);
}

function tweenPromise(scene, target, props) {
  return new Promise((resolve) => {
    scene.tweens.add({
      targets: target,
      ...props,
      onComplete: resolve,
    });
  });
}

async function moveCoinsAnimated(source, target, count) {
  const moving = [];
  for (let i = 0; i < count; i += 1) {
    moving.push(source.coins.pop());
  }
  moving.reverse();

  const targetBaseIndex = target.coins.length;
  const tasks = moving.map((denom, i) => new Promise((resolve) => {
    this.time.delayedCall(i * 45, async () => {
      const originVisual = source.visuals.pop();
      const arcX = target.x + this.slotW / 2;
      const targetIndex = targetBaseIndex + i;
      const destY = target.y + (this.coinRadius + 6) + targetIndex * this.stackStep;

      originVisual.setDepth(50);
      await tweenPromise(this, originVisual, {
        x: arcX,
        y: destY - 10,
        duration: 120,
        ease: 'Cubic.Out',
      });
      await tweenPromise(this, originVisual, {
        y: destY,
        duration: 70,
        ease: 'Quad.Out',
      });

      source.layer.remove(originVisual);
      target.layer.add(originVisual);
      originVisual.setDepth(0);
      originVisual.x = arcX;
      originVisual.y = destY;
      originVisual.baseY = destY;

      target.coins.push(denom);
      target.visuals.push(originVisual);
      this.soundFx.play('move');
      resolve();
    });
  }));

  await Promise.all(tasks);
  this.soundFx.play('place');
}

async function runDeal() {
  const slotPlans = [];
  for (const slot of this.state.slots) {
    if (!slot.unlocked) continue;
    const denom = Phaser.Math.Between(1, this.state.maxDealDenom);
    const count = Phaser.Math.Between(0, 3);
    const free = SLOT_CAPACITY - slot.coins.length;
    const toAdd = Math.min(count, free);
    slotPlans.push({ slot, denom, toAdd });
  }

  const allTasks = slotPlans.map(({ slot, denom, toAdd }) => new Promise((resolveSlot) => {
    if (toAdd <= 0) {
      resolveSlot();
      return;
    }

    let completed = 0;
    const baseIndex = slot.coins.length;
    for (let i = 0; i < toAdd; i += 1) {
      this.time.delayedCall(i * 45, async () => {
        const spawnX = slot.x + this.slotW / 2 + Phaser.Math.Between(-16, 16);
        const spawnY = slot.y - 34;
        const index = baseIndex + i;
        const targetY = slot.y + (this.coinRadius + 6) + index * this.stackStep;
        const targetX = slot.x + this.slotW / 2;

        const v = makeCoinVisual(this, denom, spawnX, spawnY);
        v.setDepth(50);
        slot.layer.add(v);

        await tweenPromise(this, v, {
          x: targetX,
          y: targetY,
          duration: 130,
          ease: 'Cubic.Out',
        });
        await tweenPromise(this, v, {
          y: targetY,
          duration: 60,
          ease: 'Quad.Out',
        });

        v.setDepth(0);
        v.x = targetX;
        v.y = targetY;
        v.baseY = targetY;
        slot.coins.push(denom);
        slot.visuals.push(v);
        this.soundFx.play('place');

        completed += 1;
        if (completed === toAdd) resolveSlot();
      });
    }
  }));

  await Promise.all(allTasks);

  let merged = true;
  while (merged) {
    merged = await resolveAllMerges.call(this);
  }
}

async function resolveAllMerges() {
  for (const slot of this.state.slots) {
    if (!slot.unlocked || slot.coins.length !== SLOT_CAPACITY) continue;
    const first = slot.coins[0];
    const mono = slot.coins.every((c) => c === first);
    if (!mono) continue;

    for (const visual of slot.visuals) {
      await tweenPromise(this, visual, {
        scaleX: 1.2,
        scaleY: 1.2,
        alpha: 0,
        duration: 120,
        ease: 'Back.In',
      });
      visual.destroy();
    }
    slot.visuals = [];
    slot.coins = [];

    this.state.credits += first;

    if (first < MAX_DENOM) {
      const nextDenom = first + 1;
      slot.coins.push(nextDenom);
      this.state.maxDealDenom = Math.max(this.state.maxDealDenom, nextDenom);
      const targetX = slot.x + this.slotW / 2;
      const targetY = slot.y + (this.coinRadius + 6);
      const v = makeCoinVisual(this, nextDenom, targetX, targetY);
      v.setScale(0.2);
      v.alpha = 0.4;
      slot.layer.add(v);
      slot.visuals.push(v);
      await tweenPromise(this, v, {
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        duration: 160,
        ease: 'Back.Out',
      });

      if (nextDenom === MAX_DENOM) {
        this.soundFx.play('merge');
        refreshHud.call(this);
        showWin.call(this);
        return true;
      }
    }

    pulseSlot.call(this, slot, 0xfff18d);
    refreshHud.call(this);
    this.soundFx.play('merge');
    return true;
  }
  return false;
}


function canUnlockSlot(slot) {
  if (slot.unlocked) return false;
  const prevUnlocked = slot.id === 0 || this.state.slots[slot.id - 1]?.unlocked;
  if (!prevUnlocked) return false;
  return this.state.credits >= slot.unlockCost;
}

function tryUnlockSlot(slotId) {
  if (this.state.gameOver) return;
  const slot = this.state.slots[slotId];
  if (!slot || slot.unlocked) return;
  const prevUnlocked = slot.id === 0 || this.state.slots[slot.id - 1]?.unlocked;
  if (!prevUnlocked || this.state.credits < slot.unlockCost) {
    pulseSlot.call(this, slot, 0xff4040);
    this.soundFx.play('invalid');
    return;
  }

  this.state.credits -= slot.unlockCost;
  slot.unlocked = true;
  slot.lockLabel.setVisible(false);
  if (slot.unlockButton) {
    slot.unlockButton.bg.destroy();
    slot.unlockButton.text.destroy();
    slot.unlockButton = null;
  }
  this.soundFx.play('click');
  refreshHud.call(this);
}

function refreshHud() {
  this.creditText.setText(`Credits: ${this.state.credits}`);
  this.state.slots.forEach((slot) => {
    if (!slot.unlockButton) return;
    const enabled = canUnlockSlot.call(this, slot);
    slot.unlockButton.bg.setFillStyle(enabled ? 0x4ea93a : 0x6a4a2a, 0.95);
    slot.unlockButton.bg.setStrokeStyle(2, enabled ? 0xcff7b2 : 0xcaa16a);
    slot.unlockButton.text.setText(`Unlock ${slot.unlockCost}`);
    slot.unlockButton.text.setColor(enabled ? '#f7ffec' : '#fff7d1');
  });
}

function showWin() {
  if (this.state.won) return;
  this.state.won = true;
  this.state.gameOver = true;
  this.state.selected = null;
  updateSelectionVisuals.call(this);

  const overlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.58);
  const panel = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 400, 270, 0x143015, 0.95)
    .setStrokeStyle(4, 0x9ef28f, 1);
  this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 66, 'You Win!', {
    fontSize: '58px',
    color: '#d6ffd2',
    fontStyle: 'bold',
    stroke: '#000000',
    strokeThickness: 7,
  }).setOrigin(0.5);
  this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 4, `Credits: ${this.state.credits}`, {
    fontSize: '34px',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 6,
  }).setOrigin(0.5);

  const retryBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 88, 180, 56, 0x50b62c, 1)
    .setStrokeStyle(3, 0xc9ffa7)
    .setInteractive({ useHandCursor: true });
  const retryLabel = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 88, 'Restart', {
    fontSize: '30px',
    color: '#fff',
    stroke: '#000',
    strokeThickness: 5,
  }).setOrigin(0.5);

  retryBg.on('pointerdown', () => {
    overlay.destroy(); panel.destroy(); retryBg.destroy(); retryLabel.destroy();
    this.scene.restart();
  });
}

function pulseSlot(slot, color) {
  const oldStroke = slot.bg.strokeColor;
  slot.bg.setStrokeStyle(5, color, 1);
  this.tweens.add({
    targets: slot.bg,
    x: slot.bg.x + 5,
    yoyo: true,
    repeat: 2,
    duration: 45,
    onComplete: () => {
      slot.bg.x = slot.x;
      slot.bg.setStrokeStyle(2, oldStroke || 0x9f5b31, 0.8);
      updateSelectionVisuals.call(this);
    },
  });
}

function hasAnyValidMove() {
  const slots = this.state.slots.filter((s) => s.unlocked);
  for (const src of slots) {
    const top = getTopGroup(src);
    if (!top) continue;
    for (const dst of slots) {
      if (src.id === dst.id) continue;
      if (dst.coins.length >= SLOT_CAPACITY) continue;
      if (!dst.coins.length || dst.coins[dst.coins.length - 1] === top.denom) {
        return true;
      }
    }
  }
  return false;
}

function checkLoss() {
  const unlocked = this.state.slots.filter((s) => s.unlocked);
  const allFull = unlocked.every((s) => s.coins.length >= SLOT_CAPACITY);
  if (!allFull) return;
  if (hasAnyValidMove.call(this)) return;

  this.state.gameOver = true;
  this.state.selected = null;
  updateSelectionVisuals.call(this);
  this.soundFx.play('invalid');

  const overlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6);
  const panel = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 380, 260, 0x2d1a12, 0.95)
    .setStrokeStyle(4, 0xf0c27b, 1);
  const title = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 64, 'Game Over', {
    fontSize: '56px',
    color: '#ffe6a6',
    fontStyle: 'bold',
    stroke: '#000000',
    strokeThickness: 7,
  }).setOrigin(0.5);
  const score = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 8, `Final Credits: ${this.state.credits}`, {
    fontSize: '34px',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 6,
  }).setOrigin(0.5);

  const retryBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 84, 180, 56, 0x50b62c, 1)
    .setStrokeStyle(3, 0xc9ffa7)
    .setInteractive({ useHandCursor: true });
  const retryLabel = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 84, 'Restart', {
    fontSize: '30px',
    color: '#fff',
    stroke: '#000',
    strokeThickness: 5,
  }).setOrigin(0.5);

  retryBg.on('pointerdown', () => {
    overlay.destroy(); panel.destroy(); title.destroy(); score.destroy(); retryBg.destroy(); retryLabel.destroy();
    this.scene.restart();
  });
}
