const { Application, Session, Message, Event, WebhookSubscription, WebhookDelivery } = require("./models");

const modelRegistry = Object.freeze({ Application, Session, Message, Event, WebhookSubscription, WebhookDelivery });

function stable(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return JSON.stringify(value.map(stable));
  if (value && typeof value === "object") {
    return JSON.stringify(Object.keys(value).sort().reduce((result, key) => {
      result[key] = value[key];
      return result;
    }, {}), (_key, item) => item && typeof item === "object" && !Array.isArray(item)
      ? Object.keys(item).sort().reduce((result, key) => { result[key] = item[key]; return result; }, {})
      : item);
  }
  return JSON.stringify(value);
}

function indexKey(index) {
  return stable(index.key || index[0]);
}

function indexOptions(index) {
  const options = index.options || index[1] || index;
  return {
    unique: options.unique === true,
    sparse: options.sparse === true,
    partialFilterExpression: options.partialFilterExpression,
  };
}

function expectedIndexName(keys, options) {
  if (options.name) return options.name;
  return Object.entries(keys).map(([key, direction]) => `${key}_${direction}`).join("_");
}

function sameDefinition(expected, actual) {
  return indexKey(expected) === indexKey(actual)
    && stable(indexOptions(expected)) === stable(indexOptions(actual));
}

async function inspectModelIndexes(model) {
  const declared = model.schema.indexes().map(([keys, options]) => ({ key: keys, options, name: expectedIndexName(keys, options) }));
  const actual = await model.collection.listIndexes().toArray();
  const missing = declared.filter((expected) => !actual.some((item) => item.name === expected.name));
  const conflicts = declared.flatMap((expected) => {
    const sameName = actual.find((item) => item.name === expected.name);
    if (sameName && !sameDefinition(expected, sameName)) return [{ model: model.modelName, expected, actual: sameName }];
    const sameKey = actual.filter((item) => indexKey(item) === indexKey(expected) && item.name !== expected.name);
    return sameKey.filter((item) => !sameDefinition(expected, item)).map((item) => ({ model: model.modelName, expected, actual: item }));
  });
  return { model: model.modelName, declared, actual, missing, conflicts };
}

async function inspectIndexes() {
  const reports = await Promise.all(Object.values(modelRegistry).map(inspectModelIndexes));
  return {
    reports,
    missing: reports.flatMap((report) => report.missing.map((index) => ({ model: report.model, index }))),
    conflicts: reports.flatMap((report) => report.conflicts),
  };
}

async function createDeclaredIndexes() {
  for (const model of Object.values(modelRegistry)) await model.createIndexes();
  return inspectIndexes();
}

module.exports = { modelRegistry, inspectIndexes, createDeclaredIndexes, sameDefinition };
