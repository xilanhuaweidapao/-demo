const express = require('express')
const app = express()

app.use('/weidapao', express.static('public'))
// url: http://localhost:3000/weidapao/test.css
app.listen(3000)