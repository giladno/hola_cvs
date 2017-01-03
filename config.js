'use strict';
const _ = require('lodash');
module.exports = _.defaultsDeep(JSON.parse(localStorage.config||'{}'), {
    cm: {
        indentUnit: 4,
        lineNumbers: true,
        collapseIdentical: true,
        connect: 'align',
    },
    lint: {
        code: false,
    },
});
