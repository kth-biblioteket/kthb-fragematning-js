const jwt = require("jsonwebtoken");
const config = require('./config.json');

function verifyToken(req, res, next) {
    let token = req.cookies.jwt

    if (!token)
        return res.sendFile(__dirname.replace(/\w*$/, '') + 'frontend/dist/login.html');


        jwt.verify(token, config.secret, async function (err, decoded) {
            if (err) {
                res.clearCookie("jwt")
                res.sendFile(__dirname.replace(/\w*$/, '') + 'frontend/dist/login.html');
            }
   
            let authorized = false;
            authorized = true;
            
            if (authorized) {
                req.token = jwt.sign({ id: req.username, role: config.roles[req.username] }, config.secret, {
                    expiresIn: "7d"
                });
                next();
            } else {
                res.clearCookie("jwt")
                res.status(401).send({ auth: false, message: 'Failed to authenticate token, ' + err.message });
                //res.render('login',{logindata: {"status":"error", "message":"Not authorized"}})
            }
        });
}

module.exports = verifyToken;