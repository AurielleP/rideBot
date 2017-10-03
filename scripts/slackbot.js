// Description:
// Fetch Price comparisons between Uber and Lyft
//
// Dependencies:
//   None
//
// Configuration:
//   None
//
// Commands:
//  - @redbot fares start {start address} end {end address} filter {filter}
//    @param  'Filter' can be one of the following:
//    @param 'surgeWatch'  = notifies you when the surge ends
//    @param 'pool'  =  returns estimates for both uber POOL, and Lyft Line
//    @param 'line'  =  returns estimates for both uber POOL, and Lyft Line
//    @param 'standard'  =  returns estimates for both uberX, and standard Lyft
//    @param 'default'  =  returns estimates for all ride types
//
//
//
//
// Notes:
//
//
// Author:
// AurielleP
//

var WebClient = require('@slack/client').WebClient;

var token = process.env.HUBOT_SLACK_TOKEN; //see section above on sensitive data

var web = new WebClient(token);

const googlePlaces = 'https://maps.googleapis.com/maps/api/place/textsearch/json?key=' + process.env.GOOGLE_PLACES_API + '&query=';
const lyftToken = process.env.LYFT_TOKEN;
const uberOauth = process.env.UBER_OAUTH;
const uberClient = process.env.UBER_CLIENT;
const uberSecret = process.env.UBER_SECRET;
const uberServer = process.env.UBER_SERVER;


const util = require('./util');

const request = require('request');
const _ = require('underscore');
const async = require('async');



module.exports = function(robot) {



    const googleMaps = (query, callback) => {
            util.getJson(googlePlaces + query, (err, response) => {
                if (err) {
                    return err;
                }
                const results = response.results[0];
                if (results) {
                    const formattedAddress = (results != null) ? results.formatted_address : undefined;
                    const geo = results.geometry.location;
                    const lat = geo.lat;
                    const lng = geo.lng;
                    const mapData = {
                        address: formattedAddress,
                        lat: lat,
                        lng: lng
                    }
                    console.log(`address=${mapData.address} lat=${mapData.lat} lng=${mapData.lng}`);
                    callback(null, mapData);

                }
            });
        },

        getAsync = (fromLocation, toLocation, callback) => {
            return async.parallel({
                queryOne: (next) => {
                    googleMaps(fromLocation, next);
                },
                queryTwo: (next) => {
                    googleMaps(toLocation, next);

                }
            }, (err, { queryOne, queryTwo }) => {
                if (err) {
                    console.log(`err=${err}`);
                    return void callback();
                }
                callback(null, { queryOne, queryTwo });
            });
        }



    getCoords = (fromLocation, toLocation, callback) => {
        console.log(`fromLocation=${fromLocation}, toLocation=${toLocation}`);
        getAsync(fromLocation, toLocation, (err, asyncResponse) => {
            if (err) {
                console.log(err);
                return void callback(err);
            }
            const queryOneCoords = _.pick(asyncResponse.queryOne, ['lat', 'lng']);
            const queryTwoCoords = _.pick(asyncResponse.queryTwo, ['lat', 'lng']);

            console.log('queryOneCoords=' + JSON.stringify(queryOneCoords) + ' queryTwoCoords=' + JSON.stringify(queryTwoCoords));
            callback(null, { queryOneCoords, queryTwoCoords });
        });




    }


    function watchSurge(fromLocation, toLocation, callback) {
        let resultsStrings;
        let results;
        getPrices(fromLocation, toLocation, (err, surgeQuery) => {
            if (err) {
                console.log(err);
                return void callback(err);
            }
            const isSurging = surgeQuery.isSurging;
            console.log(isSurging);
            if (isSurging) {
                console.log(isSurging);
                const lyftEstimate = _.findWhere(surgeQuery.lyftEstimates, { ride_type: 'lyft' });
                resultsStrings = `Surge is still active. Current Price=${lyftEstimate.cost}`;
                console.log(resultsStrings);
                callback(null, { surge: true, queries: surgeQuery });
            } else {
                console.log(isSurging);
                lyftEstimate = _.findWhere(surgeQuery.lyftEstimates, { ride_type: 'lyft' });
                resultsStrings = `Surge is Not Active=${lyftEstimate.cost}`;
                callback(null, { surge: false, queries: surgeQuery });



            }


        });
    }


    function getPrices(fromLocation, toLocation, callback) {
        let data = {}
        async.waterfall([
            (next) => {
                getCoords(fromLocation, toLocation, next);
            },

            (locations, next) => {
                const lyftQuery = `https://www.lyft.com/api/costs?start_lat=${locations.queryOneCoords.lat}&start_lng=${locations.queryOneCoords.lng}&end_lat=${locations.queryTwoCoords.lat}&end_lng=${locations.queryTwoCoords.lng}`;
                util.getJson(lyftQuery, (err, response) => {
                    let costAmount;
                    const lyftResults = response.cost_estimates
                    const estimates = [];
                    const lyftEstimates = [];
                    const raw = JSON.stringify(lyftResults, null, 2);
                    let regularRide;
                    let isSurging = false;
                    _.each(lyftResults, (result) => {
                        const costRange = '$' + (result.estimated_cost_cents_min / 100).toFixed(2) + ' - $' + (result.estimated_cost_cents_max / 100).toFixed(2);
                        if (result.estimated_cost_cents_min === result.estimated_cost_cents_max) {
                            costAmount = '$' + (result.estimated_cost_cents_min / 100).toFixed(2);
                        } else {
                            costAmount = costRange;
                        }

                        const rideData = {
                            ride_type: result.ride_type,
                            display_name: result.display_name,
                            primetime_percentage: result.primetime_percentage,
                            primetime_multiplier: result.primetime_multiplier,
                            cost_min: result.estimated_cost_cents_min,
                            cost_max: result.estimated_cost_cents_max,
                            cost: costAmount,
                            is_surging: result.primetime_multiplier > 1 ? true : false
                        }
                        estimates.push(rideData)
                        if (rideData.is_surging) {
                            const resultString = `${rideData.display_name} = ${rideData.cost} - (${rideData.primetime_multiplier}x Surge)`;
                            lyftEstimates.push({
                                resultString,
                                ride_type: rideData.ride_type,
                                display_name: rideData.display_name,
                                primetime_percentage: rideData.primetime_percentage,
                                primetime_multiplier: rideData.primetime_multiplier,
                                min: rideData.cost_min,
                                max: rideData.cost_max,
                                cost: rideData.cost,
                                is_surging: rideData.is_surging

                            });
                            isSurging = (rideData.is_surging) ? true : false;
                        } else {
                            const resultString = `${rideData.display_name} = ${rideData.cost}`;
                            lyftEstimates.push({
                                resultString,
                                ride_type: rideData.ride_type,
                                display_name: rideData.display_name,
                                primetime_percentage: rideData.primetime_percentage,
                                primetime_multiplier: rideData.primetime_multiplier,
                                min: rideData.cost_min,
                                max: rideData.cost_max,
                                cost: rideData.cost,
                                is_surging: rideData.is_surging

                            });
                        }

                    });
                    async.nextTick(() => next(null, { locations, lyftEstimates, isSurging }));

                });

            },

            (data, next) => {
                const locations = data.locations;
                const lyftEstimates = data.lyftEstimates;
                const isSurging = data.isSurging;
                const uberQuery = `https://api.uber.com/v1.2/estimates/price?start_latitude=${data.locations.queryOneCoords.lat}&start_longitude=${data.locations.queryOneCoords.lng}&end_latitude=${data.locations.queryTwoCoords.lat}&end_longitude=${data.locations.queryTwoCoords.lng}&server_token=${uberOauth}`;
                util.getJson(uberQuery, (err, response) => {
                    const uberResults = response.prices;
                    const estimates = [];
                    const uberEstimates = [];
                    const raw = JSON.stringify(uberResults, null, 2);
                    let regularRide;

                    _.each(uberResults, (result) => {
                        const rideData = {
                            ride_type: result.display_name,
                            cost: result.estimate,
                            is_surging: result.surge_multiplier > 1 ? true : false
                        }
                        estimates.push(rideData)
                        if (rideData.is_surging) {
                            const resultString = `${rideData.ride_type} = ${rideData.cost} - (${rideData.primetime_multiplier}x Surge)`;
                            uberEstimates.push({
                                resultString,
                                ride_type: rideData.ride_type,
                                cost: result.estimate,
                                is_surging: result.surge_multiplier > 1 ? true : false

                            });
                        } else {
                            const resultString = `${rideData.ride_type} = ${rideData.cost}`;
                            uberEstimates.push({
                                resultString,
                                ride_type: rideData.ride_type,
                                cost: result.estimate,
                                is_surging: result.surge_multiplier > 1 ? true : false

                            });
                        }

                    });
                    async.nextTick(() => next(null, { locations, lyftEstimates, uberEstimates, isSurging }));

                });
            }
        ], (err, data) => {
            if (err) {
                console.log(err);
                return void callback();
            }
            const preferredUber = _.pick(data.uberEstimates, ['uberX', 'POOL'])
            const preferredLyft = _.pick(data.lyftEstimates, ['uberX', 'POOL'])
            callback(null, data);
        });



    };

    aggregate = (fromLocation, toLocation, filter, callback) => {
        return getPrices(fromLocation, toLocation, (err, data) => {
            if (err) {
                console.log(err);
                return void callback(err);
            }
            callback(null, data);
        });
    }

    robot.respond(/fares start\s([\w\d\s]+)\send\s([\w\d\s]+)\sfilter\s(\S+)/i, function(res1) {
        const fromLocation = res1.match[1];
        const toLocation = res1.match[2];
        const filter = res1.match[3];

        aggregate(fromLocation, toLocation, filter, (err, queries) => {
            if (err) {
                console.log(err);
                return void callback();
            }

            let filteredQueryUberPool;
            let filteredQueryLyftLine;
            let lyftRides = (queries.lyftEstimates != undefined) ? _.pluck(queries.lyftEstimates, 'resultString').join('\n') : 'Sorry No Rides Available';

            if (queries.lyftEstimates.length && queries.uberEstimates.length) {
                switch (filter) {
                    case "pool":
                        filteredQueryUberPool = (queries.uberEstimates != []) ? _.findWhere(queries.uberEstimates, { ride_type: 'POOL' }).resultString : 'Sorry No Rides Available';
                        filteredQueryLyftLine = (queries.lyftEstimates != []) ? _.findWhere(queries.lyftEstimates, { ride_type: 'lyft_line' }).resultString : 'Sorry No Rides Available';
                        console.log(`lyft=${filteredQueryLyftLine}\nuber=${filteredQueryUberPool}`);
                        return res1.send(`${filteredQueryUberPool}\n${filteredQueryLyftLine}`);
                        break;
                    case "line":
                        filteredQueryUberPool = (queries.uberEstimates != []) ? _.findWhere(queries.uberEstimates, { ride_type: 'POOL' }).resultString : 'Sorry No Rides Available';
                        filteredQueryLyftLine = (queries.lyftEstimates != []) ? _.findWhere(queries.lyftEstimates, { ride_type: 'lyft_line' }).resultString : 'Sorry No Rides Available';
                        console.log(`lyft=${filteredQueryLyftLine}\nuber=${filteredQueryUberPool}`);
                        return res1.send(`${filteredQueryUberPool}\n${filteredQueryLyftLine}`);
                        break;
                    case "standard":
                        let filteredQueryUberStandard = (queries.uberEstimates != undefined) ? _.findWhere(queries.uberEstimates, { ride_type: 'uberX' }).resultString : 'Sorry No Rides Available';
                        let filteredQueryLyftStandard = (queries.lyftEstimates != undefined) ? _.findWhere(queries.lyftEstimates, { ride_type: 'lyft' }).resultString : 'Sorry No Rides Available';
                        console.log(`${filteredQueryLyftStandard} - ${filteredQueryUberStandard}`);
                        return res1.send(`${filteredQueryUberStandard}\n${filteredQueryLyftStandard}`);
                        break;
                    case "uber":
                        const uberRides = (queries.uberEstimates != undefined) ? _.pluck(queries.uberEstimates, 'resultString').join('\n') : 'Sorry No Rides Available';
                        console.log(uberRides);
                        return res1.send(uberRides);
                        break;
                    case "lyft":
                        console.log(lyftRides);
                        return res1.send(lyftRides);
                        break;
                    case "recommend":
                        console.log('No recommendations at this time');
                        return res1.send('No recommendations at this time');
                        break;
                    case "surgeWatch":
                        if (queries.isSurging) {
                            let currentSurge;
                            watchSurge(fromLocation, toLocation, (err, surge) => {
                                const stringSurge = JSON.stringify(surge.surge);
                                console.log(`surge ${surge.surge}`);
                                currentSurge = surge.surge;
                                console.log(currentSurge);

                                async.waterfall([
                                    (next) => {
                                        for (let numAttempts = 0; numAttempts <= 50; numAttempts++) {
                                            const previousSurge = _.findWhere(surge.queries.lyftEstimates, { ride_type: 'lyft' });
                                            if (currentSurge) {
                                                setTimeout(function() {
                                                    console.log(`current Attempt: ${numAttempts}`);
                                                    return watchSurge(fromLocation, toLocation, (err, surgeResult) => {
                                                        currentSurge = surgeResult.surge;
                                                        const currentQuery = _.findWhere(surgeResult.queries.lyftEstimates, { ride_type: 'lyft' });
                                                        console.log(currentQuery.resultString);
                                                        if (previousSurge.cost != currentQuery.cost) {
                                                            console.log(`Current Lyft Price has dropped to: ${currentQuery.resultString}`);
                                                            res1.send(`Current Lyft Price has dropped to: ${currentQuery.resultString}`);
                                                        } else {
                                                            console.log('Current Lyft Price has not changed');
                                                        }
                                                    })
                                                }, 10000 * numAttempts);
                                            }
                                        }
                                    },

                                ], (err, currentSurge) => {
                                    if (err) {
                                        console.log(err);
                                        return;
                                    }
                                    res1.send('\nSurge Has Ended\n');
                                    res1.send(_.pluck(queries.lyftEstimates, 'resultString').join('\n'));
                                    res1.send('\n');
                                    return res1.send(_.pluck(queries.lyftEstimates, 'resultString').join('\n'));
                                })
                            });

                        } else {
                            res1.send('\nNo Surge\n');
                            res1.send(_.pluck(queries.lyftEstimates, 'resultString').join('\n'));
                            res1.send('\n');
                            res1.send(_.pluck(queries.uberEstimates, 'resultString').join('\n'));

                        }
                        break;
                    default:
                        res1.send(_.pluck(queries.lyftEstimates, 'resultString').join('\n'));
                        return res1.send(_.pluck(queries.uberEstimates, 'resultString').join('\n'));
                }
            } else {
                return res1.send('Sorry No rides Available');
            }
        });



    });



    robot.hear(/surgeWatch start\s([\w\d\s]+)\send\s([\w\d\s]+)/i, function(res) {
        const fromLocation = res.match[1];
        const toLocation = res.match[2];
        let currentSurge;
        const queries = getPrices(fromLocation, toLocation, (err, queries) => {

            if (queries.isSurging) {
                let currentSurge;
                watchSurge(fromLocation, toLocation, (err, surge) => {
                    const stringSurge = JSON.stringify(surge.surge);
                    console.log(`surge ${surge.surge}`);
                    currentSurgeResult = surge.surge;
                    console.log(currentSurgeResult);
                    async.waterfall([
                        (next) => {
                            for (let numAttempts = 0; numAttempts <= 50; numAttempts++) {
                                if (currentSurgeResult) {
                                    setTimeout(function() {
                                        console.log(`current Attempt: ${numAttempts}`);
                                        return getPrices(fromLocation, toLocation, (err, surgeResult) => {
                                            const currentQuery = _.findWhere(surgeResult.queries.lyftEstimates, { ride_type: 'lyft' });
                                            console.log(currentQuery.resultString);
                                            if (surgeResult.surge != currentSurge.surge) {
                                                console.log(`Current Lyft Price has dropped to: ${currentQuery.resultString}`);
                                                res.send(`Current Lyft Price has dropped to: ${currentQuery.resultString}`);
                                            } else {
                                                console.log('Current Lyft Price has not changed');
                                            }
                                        })
                                    }, 10000 * numAttempts);
                                } else {
                                    res.send('\nNo Surge\n');
                                    res.send(_.pluck(queries.lyftEstimates, 'resultString').join('\n'));
                                    res.send('\n');
                                    return res.send(_.pluck(queries.uberEstimates, 'resultString').join('\n'));
                                }
                            }
                        },

                    ], (err, currentSurge) => {
                        if (err) {
                            console.log(err);
                            return;
                        }

                    })
                });

            } else {
                res.send('\nNo Surge\n');
                res.send(_.pluck(queries.lyftEstimates, 'resultString').join('\n'));
                res.send('\n');
                return res.send(_.pluck(queries.uberEstimates, 'resultString').join('\n'));
            }

        })

    });

}