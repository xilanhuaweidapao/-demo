const express = require('express')
const app = express()

app.use(express.static('public'));
// url: http://localhost:3000/test.css
app.listen(3000)