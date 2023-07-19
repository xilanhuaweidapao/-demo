const express = require('express')
const cors = require('cors');
const app = express();

// cors() 默认返回 Access-Control-Allow-Origin: *

app.get('/', cors(), function (req, res) {
  res.send('Hello World')
})

app.listen(3000);