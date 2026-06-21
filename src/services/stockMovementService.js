const StockMovement = require('../models/StockMovement');

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function recordStockMovement(
  {
    farmer,
    product,
    order = null,
    movementType,
    quantityChange,
    quantityAfter,
    unit = '',
    note = '',
    actorRole = 'system',
    createdBy = null
  },
  { session = null } = {}
) {
  if (!farmer || !product || !movementType) return null;

  const [movement] = await StockMovement.create(
    [
      {
        farmer,
        product,
        order,
        movementType,
        quantityChange: toNumber(quantityChange),
        quantityAfter: Math.max(0, toNumber(quantityAfter)),
        unit,
        note,
        actorRole,
        createdBy
      }
    ],
    session ? { session } : {}
  );

  return movement;
}

module.exports = {
  recordStockMovement
};
