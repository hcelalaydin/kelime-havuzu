const { createApplication } = require('../server');
const app = createApplication({ stateDir: '' });
app.server.listen(43189, '127.0.0.1');
