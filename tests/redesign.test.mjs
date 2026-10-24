import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, tick} from './helpers/load-app.mjs';
test('rapid count edits persist immediately, stay nonnegative and survive reload without duplicate dates', async () => {
  const app=loadApp();
  try {
    const button=app.document.querySelector('[data-add="100"]');
    for(let i=0;i<30;i++) app.click(button);
    const key=app.MyPay.dateKey(app.MyPay.workNow());
    const shifts=JSON.parse(app.window.localStorage.myPayShifts);
    assert.equal(shifts[key].cases,3000);assert.equal(shifts[key].total,7665);
    assert.equal(Object.keys(shifts).length,1);
    const restored=loadApp({shifts});
    try { assert.equal(restored.$('casesInput').value,'3000'); } finally {restored.close();}
    for(let i=0;i<35;i++) app.click(app.document.querySelector('[data-step="-100"]'));
    assert.equal(app.MyPay.state.shifts[key].cases,0);
    app.click(app.document.querySelector('[data-add="500"]'));
    assert.equal(app.MyPay.state.shifts[key].cases,500);
    await tick();assert.deepEqual(app.errors,[]);
  } finally {app.close();}
});
test('opening historical shift does not reprice its saved components', () => {
  const init=loadApp();const key=init.MyPay.dateKey(init.MyPay.workNow());init.close();
  const shift={cases:1000,holiday:false,base:3000,piece:1800,total:5000};
  const app=loadApp({shifts:{[key]:shift}});
  try {
    assert.match(app.text('shiftTotal'),/5 000/);assert.match(app.text('homeBonus'),/200/);
    assert.deepEqual(JSON.parse(app.window.localStorage.myPayShifts)[key],shift);
  } finally {app.close();}
});
test('browser Back restores the previous section', async () => {
  const app=loadApp();
  try {
    app.MyPay.showScreen('calendarScreen');app.MyPay.showScreen('statsScreen');
    app.window.history.back();await tick(30);
    assert.equal(app.document.querySelector('.screen.active').id,'calendarScreen');
    assert.equal(app.document.querySelector('[aria-current="page"]').dataset.screen,'calendarScreen');
  } finally {app.close();}
});
