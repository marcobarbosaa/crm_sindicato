export function validateDeployConfig(config) {
  const crons = config.triggers?.crons;
  if (!Array.isArray(crons) || crons.length !== 3 || new Set(crons).size !== 3) {
    throw new Error('Deploy interrompido: este Worker deve registrar três cron triggers. Confira também o consumo dos outros Workers da conta.');
  }
  // keep_vars preserves dashboard variables but explicit local names override them.
  if (config.keep_vars !== true || Object.keys(config.vars || {}).length !== 0) {
    throw new Error('Deploy interrompido: keep_vars deve estar ativo e vars vazio no build de produção para preservar os bindings remotos.');
  }
}
