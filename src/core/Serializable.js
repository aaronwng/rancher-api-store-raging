class Serializable {
  serialize(depth) {
    depth = depth || 0;
    var output;

    if ( depth > 10 )
    {
      return null;
    }

    if ( Array.isArray(this) )
    {
      output = this.map(function(item) {
        return recurse(item,depth+1);
      });
    }
    else
    {
      output = {};
      this.eachKeys(function(v,k) {
        output[k] = recurse(v,depth+1);
      });
    }

    return output;

    function recurse(obj,depth) {
      depth = depth || 0;
      if ( depth > 10 )
      {
        return null;
      }

      if ( Array.isArray(obj) )
      {
        return obj.map(function(item) {
          return recurse(item, depth+1);
        });
      }
      else if ( obj instanceof Serializable)
      {
        return obj.serialize(depth);
      }
      else if ( obj && typeof obj === 'object' )
      {
        var out = {};
        var keys = Object.keys(obj);
        keys.forEach(function(k) {
          out[k] = recurse(obj[k], depth+1);
        });
        return out;
      }
      else
      {
        return obj;
      }
    }
  }

  // Properties to ignore because they're built-in to ember, ember-debug, or the store
  concatenatedProperties = ['reservedKeys']
  reservedKeys = ['reservedKeys','constructor','container','store','isInstance','isDestroyed','isDestroying','concatenatedProperties','cache','factoryCache','validationCache','store']

  allKeys() {
    var reserved = this.reservedKeys;

    var out = Object.keys(this).filter((k) => {
      return k.charAt(0) !== '_' &&
        reserved.indexOf(k) === -1 &&
        typeof this[k] !== 'function';
    });

    return out;
  }

  eachKeys(fn) {
    var self = this;
    this.allKeys().forEach(function(k) {
      fn.call(self, self[k], k);
    });
  }
}

export default Serializable
