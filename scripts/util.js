const request = require('request');
const _ = require('underscore');
const async = require('async');


module.exports._fetchFromApi = (urlQuery, company, callback) => {
    console.log(`fetching data from ${company}`);
    request({
        url: urlQuery,
        method: 'GET',
        json: true,
    }, (err, response, apiResponse) => {
        return apiResponse;
    });
}


module.exports.getData = (url, callback) => {
    return request(url, (err, res, body) => {
        if (err) {
            return void callback(err);
        }

        callback(null, body);
    });
};


module.exports.getJson = (url, callback) => {
    return request(url, (err, res, body) => {
        if (err) {
            return void callback(err);
        }

        callback(null, JSON.parse(body));
    });
};