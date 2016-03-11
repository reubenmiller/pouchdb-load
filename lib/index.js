'use strict';

var utils = require('./utils');
var ajax = require('pouchdb/extras/ajax');
var Checkpointer = require('pouchdb/extras/checkpointer');
var genReplicationId = require('../libs/pouchdb-extras-custom/generateReplicationId');

function parseDump(data) {
  var docs = [];
  var lastSeq = 0;
  try {
    data.split('\n').forEach(function (line) {
      if (!line) {
        return;
      }
      line = JSON.parse(line);
      if (line.docs) {
        docs = docs.concat(line.docs);
      }
      if (line.seq) {
        lastSeq = line.seq;
      }
    });
  } catch (err) {
    return {err: err};
  }
  return {docs: docs, lastSeq: lastSeq};
}

function loadString(db, data, opts, callback) {

  var parsedDump = parseDump(data);
  if (parsedDump.err) {
    return callback(parsedDump.err);
  }
  var docs = parsedDump.docs;
  var lastSeq = parsedDump.lastSeq;

  var called = false;
  function done(res) {
    if (!called) {
      callback(res);
    }
    called = true;
  }

  db.bulkDocs({docs: docs, new_edits: false}).then(function () {
    if (!opts.proxy) {
      return done();
    }

    return db.info();
  }).then(function (info) {
    var src = new db.constructor(opts.proxy,
      utils.extend(true, {}, {}, opts));
    var target = new db.constructor(info.db_name,
      utils.extend(true, {}, db.__opts, opts));
    var replIdOpts = {};
    if (opts.filter) {
      replIdOpts.filter = opts.filter;
    }
    if (opts.query_params) {
      replIdOpts.query_params = opts.query_params;
    }

    return genReplicationId(src, target, replIdOpts).then(function (replId) {
      var state = {
        cancelled: false
      };
      var checkpointer = new Checkpointer(src, target, replId, state);
      return checkpointer.writeCheckpoint(lastSeq);
    });
  }).then(function () {
    done();
  }, done);
}

function loadUrl(db, url, opts, callback) {

  var ajaxOptions = { url: url, json: false };
  if (opts.ajax) {
    ajaxOptions = utils.extend(true, ajaxOptions, opts.ajax);
  }

  ajax(ajaxOptions, function (err, data) {
    if (err) {
      return callback(err);
    }
    loadString(db, data, opts, callback);
  });
}

exports.load = utils.toPromise(function (url, opts, callback) {
  var db = this;

  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }

  if (/^\s*\{/.test(url)) {
    // if it looks like a dump rather than a URL, interpret
    // it as a dumped string
    return loadString(db, url, opts, callback);
  }
  return loadUrl(db, url, opts, callback);
});

/* istanbul ignore next */
if (typeof window !== 'undefined' && window.PouchDB) {
  window.PouchDB.plugin(exports);
}
