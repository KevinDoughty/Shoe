/*
Copyright (c) 2015 Kevin Doughty

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

var Shoe = (function() {
  var raf = window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.msRequestAnimationFrame ||
    window.oRequestAnimationFrame;
  
  function isFunction(w) {
    return w && {}.toString.call(w) === "[object Function]";
  }
  
  function ShoeContext() {
    this.targets = [];
  }
  
  ShoeContext.prototype = {
    registerTarget: function(target) {
      if (!this.targets.length) raf(this.ticker.bind(this));
      var index = this.targets.indexOf(target);
      if (index < 0 ) this.targets.push(target);
    },
    
    deregisterTarget: function(target) {
      var index = this.targets.indexOf(target);
      if (index > -1) this.targets.splice(index, 1);
    },
    
    ticker: function() {
      this.targets.forEach( function(target) {
        var shoeRender = target.shoeRender;
        if (isFunction(shoeRender)) {
          var layer = target.layer || target;
          var render = shoeRender.bind(layer);
          render();
        }
      }.bind(this));
      if (this.targets.length) raf(this.ticker.bind(this));
    }
  }
  
  function ShoeLayer(context) {
    var model = {};
    var presentation = {};
    var animations = {};
    var animationCount = 0;
    Object.getOwnPropertyNames(this).forEach(function(name) {
      model[name] = this[name];
      Object.defineProperty(this, name, {
        get: function() {
          if (this._isProxy) { // do this differently
            var value = presentation[name];
            if (value === null || value === undefined) return model[name];
            return value;
          } else {
            return model[name];
          }
        },
        set: function(value) {
          if (this._isProxy) { // do this differently
            presentation[name] = value;
          } else {
            var animation = this.shoeAnimationForKey(name,value,this);
            if (animation) {
              animation.property = name;
              animation.from = model[name];
              animation.to = value;
              this.addAnimation(animation);
            }
            model[name] = value;
          }
        }
      });
    }.bind(this));
    
    Object.defineProperty(this, "animations", {
      get: function() {
        return Object.keys(animations).map(function (key) {
          return animations[key];
        });
      }
    });
    
    Object.defineProperty(this, "layer", {
      get: function() { // need transactions and cache presentation layer
        var compositor = {};
        var proxy = Object.create(this);
        proxy._isProxy = true; // do this differently
        var addFunctions = {};
        
        Object.keys(animations).forEach( function(key) {
          var animation = animations[key];
          var property = animation.property;
          var value = animation[animation.type]; // awkward
          if (compositor[property] === null || compositor[property] === undefined) compositor[property] = animation.zero();
          if (addFunctions[property] === null || addFunctions[property] === undefined) addFunctions[property] = animation.add;
          compositor[property] = animation.add(compositor[property],value);
        });
        
        Object.keys(compositor).forEach( function(key) {
          var model = this[key];
          var delta = compositor[key];
          var presentation = addFunctions[key](model, delta);
          proxy[key] = presentation;
        }.bind(this));
        
        return proxy;
      }
    });
    
    this.addAnimation = function(animation,name) {
      if (name === null || name === undefined) name = "" + animation.property + animationCount++;
      var context = this.context || this;
      if (!Object.keys(animations).length) context.registerTarget(this);
      animations[name] = animation;
      animation.runActionForLayerForKey(this, name);
    }
    this.addAnimationNamed = this.addAnimation;
    
    this.removeAnimation = function(name) {
      delete animations[name];
      var context = this.context || this;
      if (!Object.keys(animations).length) context.deregisterTarget(this);
    }
    this.removeAnimationNamed = this.removeAnimation;
    
    this.animationNamed = function(name) {
      return animations[name];
    }
    
    this.context = context;
    ShoeContext.call(this);
  }
  ShoeLayer.prototype = Object.create(ShoeContext.prototype);
  ShoeLayer.prototype.constructor = ShoeLayer;
  ShoeLayer.prototype.shoeAnimationForKey = function(key,target) {
    return null;
  };
  
  function ShoeValue(settings) {
    this.property;
    this.from;
    this.to;
    this.completion;
    this.duration;
    this.easing;
    this.startTime;
    
    if (settings) Object.keys(settings).forEach( function(key) {
      this[key] = settings[key];
    });
    
    this.type = "value"; // awkward
    this[this.type] = this.zero();
    
    Object.defineProperty(this, this.type, {
      get: function() {
        if (this.startTime === null || this.startTime === undefined) return this.zero();
        if (!this.duration) return this.to();
        var now = performance.now() / 1000; // need global transaction time
        var elapsed = now - this.startTime;
        var progress = elapsed / this.duration;
        if (progress >= 1) {
          if (isFunction(this.onend)) this.onend(); // do this elsewhere
          return this.zero();
        } else {
          if (isFunction(this.easing)) progress = this.easing(progress);
          return this.interpolate(this.delta,this.zero(),progress);
        }
      }
    });
    
    this.delta;
    this.onend;
    this.runActionForLayerForKey = function(layer,key) {
      this.delta = this.add(this.from,this.invert(this.to));
      
      this.onend = function() { // reverse the naming
        layer.removeAnimationNamed(key);
        if (isFunction(this.completion)) this.completion();
      }.bind(this);
      
      this.startTime = performance.now() / 1000;
    }
  }
  
  function ShoeNumber() {
    ShoeValue.call(this);
  }
  ShoeNumber.prototype = {
    zero : function() {
      return 0;
    },
    add : function(a,b) {
      return a + b;
    },
    invert : function(a) {
      return -a;
    },
    interpolate: function(a,b,progress) {
      return a + (b-a) * progress;
    }
  }
  
  function ShoeScale() {
    ShoeValue.call(this);
  }
  ShoeScale.prototype = {
    zero: function() {
      return 1;
    },
    add: function(a,b) {
      return a * b;
    },
    invert: function(a) {
      if (a === 0) return 0;
      return 1/a;
    },
    interpolate: function(a,b,progress) {
      return a + (b-a) * progress;
    }
  }
  
  return {
    Layer : ShoeLayer,
    Context : ShoeContext,
    RelativeNumber : ShoeNumber,
    RelativeScale : ShoeScale,
  }
})();