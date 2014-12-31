var l = function() {
    console.log( arguments );
}

var SimpleIndex = (function() {
    var TIMEOUT_MS = 5;
    
    var PromiseValue = function() {
        var _this = this;
        var _the_value = null;
        this.internal_promise = new Promise(function(resolve, reject) {
            _this.resolve = resolve;
            _this.reject = reject;
        });
    };

    PromiseValue.prototype.then = function(good, bad) {
        this.internal_promise.then(good, bad);
    };
    
    PromiseValue.prototype.resolve = function(value) {
        this.resolve(value);
        this._the_value = value;
    };
    
    PromiseValue.prototype.reject = function(err) {
        this.reject(err);
        this._the_value = 'error';
    };

    var CORE_COMMANDS = {};
    CORE_COMMANDS['get'] = function(si, tx, args, result, dbhandle) {
        var key = args[0];
        var store = tx.objectStore("keys");
        var index = store.index("by_key");
            
        var request = index.get(key);
        request.onsuccess = function() {
            var matching = request.result;
            if (!matching) {
                result.resolve(undefined, matching);
            } else {
                result.resolve(matching.value, matching);
            }
            dbhandle.resolve();
        }
        request.onerror = function() {
            result.reject(key);
            dbhandle.resolve();
        }
    };

    CORE_COMMANDS['set'] = function(si, tx, args, result, dbhandle) {
        var key = args[0];
        var value = args[1];

        var store = tx.objectStore("keys");
        var index = store.index("by_key");
        var request = index.openCursor(IDBKeyRange.only(key));
        
        request.onsuccess = function() {
            var cursor = request.result;
            var new_value = {'key':key, 'value':value, 'type':value.constructor.name};
            
            if (cursor) {
                cursor.update(new_value);
                result.resolve(value, new_value);
                dbhandle.resolve();
            } else {
                store.put(new_value)
                tx.oncomplete = function() {
                    result.resolve(value, new_value);
                    dbhandle.resolve();
                };
            }
        };
        
        request.onerror = function() {
            result.reject(key);
            dbhandle.resolve();
        };
    };
    
    var Simple = function(name) {
        this.name = name;
        this.db = null;

        this.command_queue = [];
        this.looper = null;
        this.COMMANDS = CORE_COMMANDS;
        if (name != false) {
            this.init_db(name);
        }
    };

    Simple.prototype.init_db = function(name) {
        if (name != undefined) {
            this.name = name;
        }
        var _this = this;
        
        if (this.db) {
            this.db.close();
        }
        this.db = null;
        this.command_queue = [];
        
        var dbp = new Promise(function(resolve, reject) {
            var db_hook = indexedDB.open(_this.name);
            
            // This will only be called if the database didn't previously exist
            // or if the version number has changed.
            db_hook.onupgradeneeded = function() {
                var db = db_hook.result;
                
                var store = db.createObjectStore("keys", {keyPath: "key"});
                var keyIndex = store.createIndex("by_key", "key", {unique:true});

                _this.db = db;
                console.log("Simple Database created.");
                setTimeout(resolve, TIMEOUT_MS);
            };
            
            // We've successfully connected to the database, because it already
            // existed and we can just start working.
            db_hook.onsuccess = function() {
                console.log('Connected to database.');
                _this.db = db_hook.result;
                setTimeout(resolve, TIMEOUT_MS);
            };
            
            db_hook.onerror = function() {
                console.log(db_hook.error);
                reject();
            };
        });
    };

    Simple.prototype.cmd = function() {
        var newargs = Array.prototype.slice.call(arguments);
        var result = new PromiseValue();
        this.command_queue.push([newargs[0], newargs.slice(1), result]);
        this.process();
        return result;
    };

    Simple.prototype.get = function(key) {
        return this.cmd('get', key);
    };

    Simple.prototype.set = function(key, value) {
        return this.cmd('set', key, value);
    };

    Simple.prototype.exists = function(key) {
        return this.cmd('exists', key);
    };

    Simple.prototype.del = function(key) {
        return this.cmd('del', key);
    };

    Simple.prototype.keys = function(match) {
        return this.cmd('keys', match);
    };

    Simple.prototype.reset_all_data = function() {
        var _this = this;
        if (this.db) { this.db.close(); }
        return new Promise(function(resolve, reject) {
            setTimeout( function() {
                var req = indexedDB.deleteDatabase( _this.name );
                
                req.onsuccess = function () {
                    setTimeout(resolve, TIMEOUT_MS);
                };
                req.onerror = function () {
                    console.log('reset error');                
                    reject();
                };
                req.onblocked = function () {
                    console.log('reset blocked')                
                    reject();
                };
            }, TIMEOUT_MS);
        });            
    };

    Simple.prototype.consume_queue = function() {
        var _this = this;

        if (this.db == null) {
            // happens if there is an error or if the db is reset.
            return;
        }
        
        if (this.command_queue.length > 0) {
            var command = this.command_queue[0];
            this.command_queue = this.command_queue.slice(1);

            var callback = _this.COMMANDS[command[0]];
            if (callback == undefined) {
                throw "Undefined command: " + command[0];
            }

            var args = command[1];
            var dbhandle = new PromiseValue();
            
            var result_promise = command[2];
            var p = callback(_this, _this.db.transaction("keys", "readwrite"), args, result_promise, dbhandle);
            
            dbhandle.then(function() {
                _this.looper = setTimeout(function() { _this.consume_queue(); }, TIMEOUT_MS);
            });
        } else {
            clearTimeout(_this.looper);
            _this.looper = null;
        }
    };

    Simple.prototype.process = function() {
        var _this = this;
        if (this.looper == null) {
            this.looper = setTimeout(function() { _this.consume_queue(); }, TIMEOUT_MS);
        }
    };
    
    return Simple;
})();

var SimpleRedis = (function() {
    var SimpleRedisCore = function(name) {
        this.init_db(name);
        
        this.COMMANDS['rpush'] = function(si, tx, args, result, dbhandle) {
            si.cmd('get', args[0]).then(function(r) {
                if (r == undefined) {
                    // key doesn't exist yet.
                    var nargs = args.slice(1);
                    si.cmd('set', args[0], JSON.stringify(nargs));
                    result.resolve(nargs.length);
                } else {
                    var nargs = args.slice(1);
                    var prev = JSON.parse(r.value);
                    var newval = prev.concat(nargs);
                    si.cmd('set', args[0], JSON.stringify(newval));
                    result.resolve(newval.length);
            }
            });
            dbhandle.resolve();
        };
        
        this.COMMANDS['lpush'] = function(si, tx, args, result, dbhandle) {
            si.cmd('get', args[0]).then(function(r) {
                if (r == undefined) {
                    // key doesn't exist yet.
                    var nargs = args.slice(1);
                    si.cmd('set', args[0], JSON.stringify(nargs));
                    result.resolve(nargs.length);
                } else {
                    var nargs = args.slice(1);
                    var prev = JSON.parse(r.value);
                    var newval = nargs.concat(prev);
                    si.cmd('set', args[0], JSON.stringify(newval));
                    result.resolve(newval.length);
                }
            });
            dbhandle.resolve();
        };
        
        this.COMMANDS['lpop'] = function(si, tx, args, result, dbhandle) {
            si.cmd('get', args[0]).then(function(r) {
                if (r == undefined) {
                    // key doesn't exist yet.
                    var nargs = args.slice(1);
                    si.cmd('set', args[0], JSON.stringify(nargs));
                    result.resolve(undefined);
                } else {
                    var nargs = args.slice(1);
                    var prev = JSON.parse(r.value);
                    var ret = prev[0];
                    var newval = prev.slice(1);
                    si.cmd('set', args[0], JSON.stringify(newval));
                    result.resolve(ret);
                }
            });
            dbhandle.resolve();        
        };
        
        this.COMMANDS['rpop'] = function(si, tx, args, result, dbhandle) {
            si.cmd('get', args[0]).then(function(r) {
                if (r == undefined) {
                    // key doesn't exist yet.
                    var nargs = args.slice(1);
                    si.cmd('set', args[0], JSON.stringify(nargs));
                    result.resolve(undefined);
                } else {
                    var nargs = args.slice(1);
                    var prev = JSON.parse(r.value);
                    var ret = prev[prev.length-1];
                    var newval = prev.slice(0,prev.length-1);
                    si.cmd('set', args[0], JSON.stringify(newval));
                    result.resolve(ret);
                }
            });
            dbhandle.resolve();        
        };
    };

    SimpleRedisCore.prototype = new SimpleIndex(false);

    return SimpleRedisCore;
})();

if (typeof jsredis_module !== 'undefined') {
    jsredis_module.exports.storage = storage;
}
