import Serializable from './Serializable'
import {normalizeType} from '../utils/normalize'
import { applyHeaders } from '../utils/apply-headers';
import urlOptions from '../utils/urlOptions'
import createHttp from '../utils/createHttp'
import fetch from '../utils/fetch';

// build-in Models
import Resource  from '../models/Resource'
import Error  from '../models/Error'
import Schema  from '../models/Schema'
import Collection  from '../models/Collection'

export const defaultMetaKeys = [
  'actionLinks',
  'createDefaults',
  'createTypes',
  'filters',
  'links',
  'pagination',
  'resourceType',
  'sort',
  'sortLinks',
  'type'
];


export const neverMissing = [
  'error',
]

const PREFIX = 'store'
let count = 0

class Store {
  static __stores = {}
  headers = null
  reopen(opt = {}) {
    Object.entries(opt).forEach(([k, v]) => {
      let getter = opt.__lookupGetter__(k)
      if(getter){
        this.__defineGetter__(k,getter)
      }else{
        this[k] = v
      }
    })
  }
  generation = 0
  defaultTimeout = 30000
  defaultPageSize = 1000
  baseUrl = '/v1'
  metaKeys = null
  constructor(name, opt) {

    if (typeof name ==='string') {
      const catchedStore = Store.__stores[name]
      if(catchedStore) {
        return catchedStore
      }
    } else {
      if (typeof opt === 'undefined') {
        opt = name || {}
      }
      name = `${PREFIX}-${count++}`
    }

    opt = opt || {}

    Store.__stores[name] = this

    let {http, ...rest} = opt

    this.header = {}

    Object.entries(rest).forEach(([k, v]) => {
      this[k] = v
    })

    if (!http) {
      http = createHttp()
    }

    this.http = http

    if (!this.neverMissing) {
      this.neverMissing = neverMissing.slice()
    }

     if (!this.metaKeys)
    {
      this.metaKeys = defaultMetaKeys.slice();
    }
    // Registering build-in Models
    this.registerModel('schema', Schema)
    this.registerModel('resource', Resource)
    this.registerModel('collection', Collection)
    this.registerModel('error', Error)

    this._state = {
      cache: {},
      cacheMap: {},
      shoebox: null,
      classCache: null,
      foundAll: {},
      findQueue: {},
      missingMap: {},
      watchHasMany: null,
      watchReference: null,
      missingReference: null,
    }
    this.reset();
  }

  modelFor(type) {
    if (!this._modelMap) {
      this._modelMap = {}
    }
    let Model = this._modelMap[type]
    if (!Model) {
      console.log(`model for [${type}] not found, fallback to resource model`)
      Model = this.modelFor('resource')
    }
    this._modelMap[type] = Model
    return Model
  }

  registerModel(type, model) {
    if (!this._modelMap) {
      this._modelMap = {}
    }

    if (typeof type === 'string') {
      this._modelMap[type] = model
      return
    }

    if (typeof type === 'object') {
      Object.entries(type).map(([k, v]) => {
        this._modelMap[k] = v
      })
      return
    }
  }

  replaceModel(type, model) {
    if (typeof type !== 'string') {
      throw new Error(`type must be type of string, got ${type}`)
    }
    this._modelMap[type] = model
    return this
  }

  unRegisterModel(type) {
    const modelMap = this._modelMap
    if (typeof type === 'string') {
      modelMap[type] = null
    }
    if (Array.isArray(type)) {
      type.forEach(t => {
        modelMap[t] = null
      })
    }
  }

  getById(type, id) {
    type = normalizeType(type)
    const group = this._groupMap(type)
    return group[id]
  }

  // Synchronously returns whether record for [type] and [id] is in the local cache.
  hasRecordFor(type, id) {
    return !!this.getById(type, id)
  }

  // Synchronously returns whether this exact record object is in the local cache
  hasRecord(obj) {
    if (!obj) return false
    const type = normalizeType(obj.type)
    const group = this._groupMap(type)
    return group[obj.id] === obj
  }

  haveAll(type) {
    type = normalizeType(type)
    return this._state.foundAll[type]
  }

  // Returns a 'live' array of all records of [type] in the cache.
  all(type) {
    type = normalizeType(type)
    return this._group(type)
  }

  // find(type) && return all(type)
  findAll(type, opt = {}) {
    type = normalizeType(type)
    if (this.haveAll(type) && opt.forceReload !== true) {
      // already cached
      return Promise.resolve(this.all(type));
    } else {
      return this.find(type, undefined, opt).then(() => this.all(type))
    }
  }

  // Get the cache array group for [type]
  _group(type) {
    type = normalizeType(type)
    const cache = this._state.cache
    let group = cache[type]
    if (!group) {
      group = []
      cache[type] = group
    }
    return group
  }

  // Get the cache map group for [type]
  _groupMap(type) {
    type = normalizeType(type)
    const cache = this._state.cacheMap
    let group = cache[type]
    if (!group) {
      group = {}
      cache[type] = group
    }
    return group
  }

  // Handle missing records in denormalized arrays
  // Get the cache map missing for [type]
  _missingMap(type) {
    type = normalizeType(type)
    const cache = this._state.missingMap
    let group = cache[type]
    if (!group) {
      group = {}
      cache[type] = group
    }
    return group
  }

  _missing(type, id, dependent, key) {
    type = normalizeType(type)
    const missingMap = this._missingMap(type)
    let entries = missingMap[id]
    if (!entries) {
      entries = []
      missingMap[id] = entries
    }
    entries.push({o: dependent, k: key})
  }

  _notifyMissing(type, id) {
    const missingMap = this._missingMap(type)
    const entries = missingMap[id]
    // todo
    if (entries) {
      entries.forEach((entry) => {
        entry.o.notifyPropertyChange(entry.k)
      })
      entries.clear()
    }
  }
  // Get the shoebox group for [type]
  _shoebox(type) {
    type = normalizeType(type, this);
    var box = this._state.shoebox;
    if ( !box ) {
      return null;
    }

    var group = box[type];
    if ( !group ) {
      group = {};
      box[type] = group;
    }

    return group;
  }

  // Add a record instance of [type] to cache
  _add(type, obj) {
    type = normalizeType(type, this);
    const id = obj.id;
    const group = this._group(type);
    const groupMap = this._groupMap(type);
    const shoebox = this._shoebox(type);

    group.push(obj);
    groupMap[obj.id] = obj;

    if ( shoebox ) {
      shoebox[obj.id] = obj.serialize();
    }

    // // Update hasMany relationships
    // const watches = this._state.watchHasMany[type]||[];
    // const notify = [];

    // let watch, val;
    // for ( let i = 0 ; i < watches.length ; i++ ) {
    //   watch = watches[i];
    //   val = obj.get(watch.targetField);
    //   notify.push({type: watch.thisType, id: val, field: watch.thisField, sourceStore: watch.sourceStore});
    // }

    // // Update references relationships that have been looking for this resource
    // const key = type+':'+id;
    // const missings = this._state.missingReference[key];
    // if ( missings ) {
    //   notify.push(missings);
    //   delete this._state.missingReference[key];
    // }

    // this.notifyFieldsChanged(notify);

    if ( obj.wasAdded && typeof obj.wasAdded === 'function' ) {
      obj.wasAdded();
    }
  }

  // Add a lot of instances of the same type quickly.
  //   - There must be a model for the type already defined.
  //   - Instances cannot contain any nested other types (e.g. subtypes),
  //     (they will not be deserialized into their correct type.)
  //   - wasAdded hooks are not called
  // Basically this is just for loading schemas faster.
  _bulkAdd(type, pojos) {
    type = normalizeType(type, this);
    const group = this._group(type);
    const groupMap = this._groupMap(type);
    const shoebox = this._shoebox(type);
    const cls = getOwner(this).lookup('model:'+type);
    group.push(pojos.map((input)=>  {

      // actions is very unhappy property name for Ember...
      if ( this.replaceActions && typeof input.actions !== 'undefined')
      {
        input[this.replaceActions] = input.actions;
        delete input.actions;
      }

      // Schemas are special
      if ( type === 'schema' ) {
        input._id = input.id;
        input.id = normalizeType(input.id, this);
      }

      input.store = this;
      let obj =  cls.constructor.create(input);
      groupMap[obj.id] = obj;

      if ( shoebox ) {
        shoebox[obj._id || obj.id] = obj.serialize();
      }

      return obj;
    }));
  }

  // Remove a record of [type] from cache, given the id or the record instance.
  _remove(type, obj) {
    type = normalizeType(type, this);
    const id = obj.id;
    const group = this._group(type);
    const groupMap = this._groupMap(type);
    const shoebox = this._shoebox(type);

    group.removeObject(obj);
    delete groupMap[id];

    if ( shoebox ) {
      delete shoebox[id];
    }

    // // Update hasMany relationships that refer to this resource
    // const watches = this._state.watchHasMany[type]||[];
    // const notify = [];
    // let watch;
    // for ( let i = 0 ; i < watches.length ; i++ ) {
    //   watch = watches[i];
    //   notify.push({
    //     type: watch.thisType,
    //     id: obj.get(watch.targetField),
    //     field: watch.thisField
    //   });
    // }

    // // Update references relationships that have used this resource
    // const key = type+':'+id;
    // const existing = this._state.watchReference[key];
    // if ( existing ) {
    //   notify.push(existing);
    //   delete this._state.watchReference[key];
    // }

    // this.notifyFieldsChanged(notify);

    if ( obj.wasRemoved && typeof obj.wasRemoved === 'function' ) {
      obj.wasRemoved();
    }

    // If there's a different baseType, remove that one too
    const baseType = normalizeType(obj.baseType, this);
    if ( baseType && type !== baseType ) {
      this._remove(baseType, obj);
    }
  }

  // Turn a POJO into a Model: {updateStore: true}
  _typeify(input, opt=null) {
    if ( !input || typeof input !== 'object') {
      // Simple values can just be returned
      return input;
    }

    if ( !opt ) {
      opt = {applyDefaults: false};
    }

    let type = input.type;
    if ( isArray(input) ) {
      // Recurse over arrays
      return input.map(x => this._typeify(x, opt));
    } else if ( !type ) {
      // If it doesn't have a type then there's no sub-fields to typeify
      return input;
    }

    type = normalizeType(type, this);
    if ( type === 'collection') {
      return this.createCollection(input, opt);
    } else if ( !type ) {
      return input;
    }

    let rec = this.createRecord(input, opt);
    if ( !input.id || opt.updateStore === false ) {
      return rec;
    }

    // This must be after createRecord so that mangleIn() can change the baseType
    let baseType = normalizeType(rec.get('baseType'), this);
    if ( baseType ) {
      // Only use baseType if it's different from type
      if ( baseType === type ) {
        baseType = null;
      }
    }

    let out = rec;
    this._add(type, rec);

    if ( baseType ) {
      this._add(baseType, rec);
    }
    return out;
  }

  notifyFieldsChanged(ary) {
    let entry, tgt;
    for ( let i = 0 ; i < ary.length ; i++ ) {
      entry = ary[i];
      if ( entry.sourceStore ) {
        tgt = entry.sourceStore.getById(entry.type, entry.id);
      } else {
        tgt = this.getById(entry.type, entry.id);
      }

      if ( tgt ) {
        //console.log('Notify', entry.type, entry.id, 'that', entry.field,'changed');
        tgt.notifyPropertyChange(entry.field);
      }
    }
  }
  isCacheable(opt) {
    return !opt || (opt.depaginate && !opt.filter && !opt.include);
  }
  // Forget about all the resources that hae been previously remembered.
  reset() {
    const state = this._state;

    var cache = state.cache;
    if ( cache ) {
      Object.keys(cache).forEach((key) => {
        if ( cache[key] && cache[key].clear ) {
          cache[key].clear();
        }
      });
    } else {
      state.cache = {};
    }

    var foundAll = state.foundAll;
    if ( foundAll ) {
      Object.keys(foundAll).forEach((key) => {
        foundAll[key] = false;
      });
    } else {
      state.foundAll = {};
    }

    if ( state.shoebox ) {
      state.shoebox = {};
    }

    state.cacheMap = {};
    state.findQueue = {};
    state.classCache = [];
    state.watchHasMany = {};
    state.watchReference = {};
    state.missingReference = {};
    this.generation +=1 ;
  }

  resetType(type) {
    type = normalizeType(type, this);
    var group = this._group(type);
    this._state.foundAll[type] = false;
    this._state.cacheMap[type] = {};

    if ( this._state.shoebox ) {
      this._state.shoebox[type] = {};
    }

    group.clear();
  }
  // Asynchronous, returns promise.
  // find(type[,null, opt]): Query API for all records of [type]
  // find(type,id[,opt]): Query API for record [id] of [type]
  // opt:
  //  filter: Filter by fields, e.g. {field: value, anotherField: anotherValue} (default: none)
  //  include: Include link information, e.g. ['link', 'anotherLink'] (default: none)
  //  forceReload: Ask the server even if the type+id is already in cache. (default: false)
  //  limit: Number of reqords to return per page (default: 1000)
  //  depaginate: If the response is paginated, retrieve all the pages. (default: true)
  //  headers: Headers to send in the request (default: none).  Also includes ones specified in the model constructor.
  //  url: Use this specific URL instead of looking up the URL for the type/id.  This should only be used for bootstrap
  find(type, id, opt) {
    type = normalizeType(type, this);
    opt = opt || {};
    opt.depaginate = opt.depaginate !== false;

    if ( !id && !opt.limit ) {
      opt.limit = this.defaultPageSize;
    }

    if ( !type ) {
      return Promise.reject(new Error({detail: 'type not specified'}));
    }

    // If this is a request for all of the items of [type], then we'll remember that and not ask again for a subsequent request
    var isCacheable = this.isCacheable(opt);
    opt.isForAll = !id && isCacheable;

    // See if we already have this resource, unless forceReload is on.
    if ( opt.forceReload !== true ) {
      if ( opt.isForAll && this._state.foundAll[type] ) {
        return Promise.resolve(this.all(type),'Cached find all '+type);
      } else if ( isCacheable && id ) {
        var existing = this.getById(type,id);
        if ( existing ) {
          return Promise.resolve(existing,'Cached find '+type+':'+id);
        }
      }
    }

    // If URL is explicitly given, go straight to making the request.  Do not pass go, do not collect $200.
    // This is used for bootstraping to load the schema initially, and shouldn't be used for much else.
    if ( opt.url ) {
      return this._findWithUrl(opt.url, type, opt);
    } else {
      // Otherwise lookup the schema for the type and generate the URL based on it.
      return this.find('schema', type, {url: 'schemas/'+encodeURIComponent(type)}).then((schema) => {
        if ( schema ) {
          var url = schema.linkFor('collection') + (id ? '/'+encodeURIComponent(id) : '');
          if ( url ) {
            return this._findWithUrl(url, type, opt);
          }
        }

        return Promise.reject(new Error({detail: 'Unable to find schema for "' + type + '"'}));
      });
    }
  }

  _headers(perRequest) {
    const out = {
      'Accept': 'application/json',
      'Content-type': 'application/json',
    }
    applyHeaders(this.headers, out);
    applyHeaders(perRequest, out);
    return out
  }

  normalizeUrl(url, includingAbsolute=false) {
    let origin;

    // Make absolute URLs to ourselves root-relative
    if ( includingAbsolute && url.indexOf(origin) === 0 ) {
      url = url.substr(origin.length);
    }

    // Make relative URLs root-relative
    if ( !url.match(/^https?:/) && url.indexOf('/') !== 0 ) {
      url = this.baseUrl.replace(/\/\+$/,'') + '/' + url;
    }

    return url;
  }
  rawRequest(opt) {
    opt.url = this.normalizeUrl(opt.url);
    opt.headers = this._headers(opt.headers);
    if ( typeof opt.dataType === 'undefined' ) {
      opt.dataType = 'text'; // Don't let jQuery JSON parse
    }

    if ( opt.timeout !== null && !opt.timeout ) {
      opt.timeout = this.defaultTimeout;
    }

    if ( opt.data ) {
      if ( !opt.contentType ) {
        opt.contentType = 'application/json';
      }

      if ( opt.data instanceof Serializable) {
        opt.data = JSON.stringify(opt.data.serialize());
      } else if ( typeof opt.data === 'object' ) {
        opt.data = JSON.stringify(opt.data);
      }
    }

    const out = fetch(opt.url, opt);

    return out;
  }
  _requestSuccess(xhr,opt) {
    opt.responseStatus = xhr.status;

    if ( xhr.status === 204 ) {
      return;
    }

    if ( xhr.body && typeof xhr.body === 'object' ) {
      let response = this._typeify(xhr.body);
      delete xhr.body;
      Object.defineProperty(response, 'xhr', {value: xhr, configurable: true});

      // Depaginate
      if ( opt.depaginate && typeof response.depaginate === 'function' ) {
        return response.depaginate().then(function() {
          return response;
        }).catch((xhr) => {
          return this._requestFailed(xhr,opt);
        });
      } else {
        return response;
      }
    } else {
      return xhr.body;
    }
  }

  _requestFailed(xhr,opt) {
    var body;

    if ( xhr.err ) {
      if ( xhr.err === 'timeout' ) {
        body = new Error({
          code: 'Timeout',
          status: xhr.status,
          message: `API request timeout (${opt.timeout/1000} sec)`,
          detail: (opt.method||'GET') + ' ' + opt.url,
        });
      } else {
        body = new Error({
          code: 'Xhr',
          status: xhr.status,
          message: xhr.err
        });
      }

      return finish(body);
    } else if ( xhr.body && typeof xhr.body === 'object' ) {
      let out = finish(this._typeify(xhr.body));

      return out;
    } else {
      body = new Error({
        status: xhr.status,
        message: xhr.body || xhr.message,
      });

      return finish(body);
    }

    function finish(body) {
      if ( !( body instanceof Error )){
        body = new Error(body);
      }

      delete xhr.body;
      Object.defineProperty(body, 'xhr', {value: xhr, configurable: true});
      return Promise.reject(body);
    }
  }

  // Makes an AJAX request that resolves to a resource model
  request(opt) {
    opt.url = this.normalizeUrl(opt.url);
    opt.depaginate = opt.depaginate !== false;

    if ( this.mungeRequest ) {
      opt = this.mungeRequest(opt);
    }

    return this.rawRequest(opt).then((xhr) => {
      return this._requestSuccess(xhr,opt);
    }).catch((xhr) => {
      return this._requestFailed(xhr,opt);
    });
  }

  _findWithUrl(url, type, opt) {
    const queue = this._state.findQueue
    const Model = this.modelFor(type)
    url = urlOptions(url, opt, Model)

    // Collect Headers
    const newHeaders = {}
    if (Model && Model.headers) {
      applyHeaders(Model.headers, newHeaders, true)
    }
    applyHeaders(opt.headers, newHeaders, true)
    // End: Collect headers

    let later
    const queueKey = JSON.stringify(newHeaders) + url

    // check to see if the request is in the findQueue
    if (queue[queueKey]) {
      // get the filterd promise object
      const filteredPromise = queue[queueKey]
      const defer = {}
      defer.promise = new Promise(function(resolve, reject) {
        defer.resolve = resolve
        defer.reject = reject
      })
      filteredPromise.push(defer)
      later = defer.promise
    } else { // request is not in the findQueue
      opt.url = url
      opt.headers = newHeaders
      later = this.request(opt).then((result) => {
        if (opt.isForAll) {
          this._state.foundAll[type] = true

          // todo what is removeMissing ?
          if (opt.removeMissing && result.type === 'collection') {
            const all = this._group(type)
            const toRemove = []
            all.forEach(obj => {
              if (!result.includes(obj)) {
                toRemove.push(obj)
              }
            })

            toRemove.forEach((obj) => {
              this._remove(type, obj)
            })
          }
        }
        this._finishFind(queueKey, result, 'resolve')
        return result
      }, reason => {
        this._finishFind(queueKey, reason, 'reject')
        return Promise.reject(reason)
      })
      // set the queue array to empty indicating we've had 1 promise already
      queue[queueKey] = []
    }
    return later
  }
  _finishFind(key, result, action) {
    const queue = this._state.findQueue
    const promises = queue[key]

    if (promises) {
      while (promises.length) {
        if (action === 'resolve') {
          promises.pop().resolve(result)
        } else if (action === 'reject') {
          promises.pop().reject(result)
        }
      }
    }
    delete queue[key]
  }
  // Create a collection: {key: 'data'}
  createCollection(input, opt) {
    const dataKey = (opt && opt.key ? opt.key : 'data')
    const Model = this.modelFor('collection')
    const content = input[dataKey].map(x => this._typeify(x, opt))
    const output = new Model({content})

    Object.defineProperty(output, 'store', {value: this, configurable: true})
    // todo, should be this.metaKeys
    defaultMetaKeys.forEach(key => {
      output[key] = input[key]
    })
    return output
  }
  // Create a record: {applyDefaults: false}
  createRecord(data, opt = {}) {
    const type = normalizeType(opt.type || data.type)
    if (!type) {
      throw new Error('Missing type:  can not create record without a type')
    }

    const schema = this.getById('schema', type)
    let input = data
    if (opt.applyDefaults !== false && schema) {
      input = schema.getCreateDefaults(data)
    }

    const Model = this.modelFor(type)
    if ( Model.mangleIn && typeof Model.mangleIn === 'function' ) {
      input = Model.mangleIn(input, this)
    }

    if (schema) {
      const fields = schema.typeifyFields
      for (let i = fields.length-1; i >= 0; i--) {
        const k = fields[i]
        if (input[k]) {
          input[k] = this._typeify(input[k], opt)
        }
      }
    }
    const output = new Model(input)
    Object.defineProperty(output, 'store', {enumerable: false, value: this, configurable: true})
    return output
  }
  // Turn a POJO into a Model: {updateStore: true}
  _typeify(input, opt = null) {
    if ( !input || typeof input !== 'object') {
      // Simple values can just be returned
      return input
    }
    if (!opt) {
      opt = {applyDefaults: false}
    }
    let type = input.type
    type = normalizeType(type)
    if (Array.isArray(input) ) {
      // Recurse over arrays
      return input.map(x => this._typeify(x, opt))
    }

    if (type === 'collection') {
      return this.createCollection(input, opt)
    } else if (!type) {
      return input
    }

    const rec = this.createRecord(input, opt)
    if (!input.id || opt.updateStore === false) {
      return rec
    }

    // This must be after createRecord so that mangleIn() can change the baseType
    let baseType = rec.baseType
    if (baseType) {
      baseType = normalizeType(baseType)

      // Only use baseType if it's different from type
      if (baseType === type) {
        baseType = null
      }
    }

    let out = rec
    const cacheEntry = this.getById(type, rec.id)
    let baseCacheEntry
    if (baseType) {
      baseCacheEntry = this.getById(baseType, rec.id)
    }
    if (cacheEntry) {
      cacheEntry.replaceWith(rec)
      out = cacheEntry
    } else {
      this._add(type, rec)
      if (baseType) {
        this._add(baseType, rec)
      }
    }
    // if (type && !this.neverMissing.includes(type)) {
    //   this._notifyMissing(type, rec.id)
    //   if (baseType && !this.neverMissing.includes(type)) {
    //     this._notifyMissing(baseType, rec.id)
    //   }
    // }
    return out
  }
}

export default Store
