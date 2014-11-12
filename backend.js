// Backend communication
var Connector = require("pebbles-client").Connector;
var P = require("bluebird");
var Uid = require("pebbles-uid");
var debug = require("debug")('bandwagon-nb');

var connector = new Connector({
  baseUrl: "http://pebbles.o5.no",
  clientClasses: require("pebbles-client/clients")
});

connector.use({pulp: 1, checkpoint: 1, grove: 1});

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

function serviceGetter(service) {
  return function(endpoint, options) {
    return P.cast(connector[service].get(endpoint, options))
      .catch(function(error) {
        debug("Got error while requesting from service %s / %s: %s", service, endpoint, error.message);
        throw error;
      }).then(get('body'));

  };
}

var getFromGrove = serviceGetter('grove');
var getFromPulp = serviceGetter('pulp');
var getFromCheckpoint = serviceGetter('checkpoint');

var _postCache = {};
var _identityCache = {};
var _publicationCache = {};
module.exports = {
  fetchPosts: function(uid, params) {
    return getFromGrove('/posts/'+uid, params).then(function(body) {
      return {
        posts: body.posts.map(get('post')),
        pagination: body.pagination
      };
    });
  },
  fetchPost: function(uid) {
    var oid = new Uid(uid).oid();
    if (!_postCache[oid]) {
      _postCache[oid] = getFromGrove("/posts/" + uid).then(get('post'));
    }
    return _postCache[oid]
  },
  fetchIdentity: function(id) {
    if (!_identityCache[id]) {
      _identityCache[id] = getFromCheckpoint("/identities/" + id);
    }
    return _identityCache[id]
  },
  fetchPublication: function(label) {
    if (!_publicationCache[label]) {
      _publicationCache[label] = getFromPulp("/apdm/publications/" + label).then(get('publication'));
    }
    return _publicationCache[label]
  }
};
