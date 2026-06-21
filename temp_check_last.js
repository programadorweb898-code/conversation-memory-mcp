const getLastSessionContext = require('./src/tools/getLastSessionContext');

(async () => {
  try {
    const result = await getLastSessionContext();
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err);
  }
})();
