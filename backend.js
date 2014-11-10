// Backend communication
var Connector = require("pebbles-client").Connector;
var P = require("bluebird");
var Uid = require("pebbles-uid");

var connector = new Connector({
  baseUrl: "http://pebbles.o5.no",
  clientClasses: require("pebbles-client/clients")
});

connector.use({grove: 1});

function combine() {
  var fns = Array.prototype.slice.call(arguments);
  return function(data) {
    return fns.reduce(function(val, fn) {
      return fn(val);
    }, data);
  }
}

function get(property) {
  return function (object) {
    return object[property];
  }
}

function getFromGrove() {
  return P.cast(connector.grove.get.apply(connector.grove, arguments));
}

var _cache = {};
module.exports = {
  fetchPosts: function(uid, params) {
    return getFromGrove('/posts/'+uid, params).then(get('body')).then(function(body) {
      return {
        posts: body.posts.map(get('post')),
        pagination: body.pagination
      };
    });
  },
  fetchPost: function(uid) {
    var oid = new Uid(uid).oid();
    if (!_cache[oid]) {
      _cache[oid] = getFromGrove("/posts/" + uid).then(combine(get('body'), get('post')));
    }
    return _cache[oid]
  }
};
