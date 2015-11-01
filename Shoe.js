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
  
  function shallowCopyAnimation(object) { // only for subclasses of ShoeValue
    var constructor = object.constructor;
    var copy = new constructor(object.settings);
    var keys = Object.getOwnPropertyNames(object);
    var length = keys.length;
    for (var i = 0; i < length; i++) {
      Object.defineProperty(copy, keys[i], Object.getOwnPropertyDescriptor(object, keys[i]));
    }
    return copy;
  }
  
  function ShoeContext() {
    this.targets = [];
  }
  
  ShoeContext.prototype = {
    registerTarget: function(target) {
      if (!this.targets.length) raf(this.ticker.bind(this));
      var index = this.targets.indexOf(target);
      if (index < 0) this.targets.push(target);
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
    var activeAnimations = {};
    var defaultAnimations = {};
    var animationCount = 0;
    
    this.registerAnimatableProperty = function(name, defaultValue) {
      var defaultAnimation = defaultValue;
      if (isFunction(defaultValue)) defaultAnimation = new defaultValue();
      var descriptor = Object.getOwnPropertyDescriptor(this, name);
      if (descriptor && descriptor.configurable === false) {
        console.log("ShoeLayer:%s; registerAnimatableProperty:%s; already defined:%s;",this,name, JSON.stringify(descriptor),this);
        return;
      }
      if (defaultAnimation) defaultAnimations[name] = defaultAnimation;
      else if (defaultAnimations[name]) delete defaultAnimations[name];
      
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
            var animation;
            var description = this.shoeAnimationForKey(name,value,this);
            var defaultAnimation = defaultAnimations[name];
            if (description && description instanceof ShoeValue) {
              animation = shallowCopyAnimation(description);
            } else if (description && typeof description === "object" && isFunction(defaultAnimation)) {
              animation = new defaultAnimation(description);
              if (!animation instanceof ShoeValue) animation = null;
            } else if (defaultAnimation instanceof ShoeValue) {
              animation = shallowCopyAnimation(defaultAnimation);
              if (description && typeof description === "object") {
                Object.keys(description).forEach( function(key) {
                  animation[key] = description[key];
                });
              }
            }
            if (animation) {
              if (animation.property === null || animation.property === undefined) animation.property = name;
              if (animation.from === null || animation.from === undefined) animation.from = model[name];
              if (animation.to === null || animation.to === undefined) animation.to = value;
              this.addAnimation(animation); // this will copy a second time. 
            }
            model[name] = value;
            if (!animation) {
              // need to manually call render on property value change without animation. transactions.
              var shoeRender = this.shoeRender;
              if (isFunction(shoeRender)) {
                var layer = this.layer || this;
                var render = shoeRender.bind(layer);
                render();
              }
            }
          }
        }
      });
    }
  
    Object.defineProperty(this, "animations", {
      get: function() {
        return Object.keys(activeAnimations).map(function (key) {
          return activeAnimations[key];
        });
      }
    });
    
    Object.defineProperty(this, "layer", {
      get: function() { // need transactions and cache presentation layer
        var compositor = {};
        var proxy = Object.create(this);
        proxy._isProxy = true; // do this differently
        var addFunctions = {};
        
        Object.keys(activeAnimations).forEach( function(key) {
          var animation = activeAnimations[key];
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
      if (!Object.keys(activeAnimations).length) context.registerTarget(this);
      var copy = shallowCopyAnimation(animation);
      activeAnimations[name] = copy;
      copy.runActionForLayerForKey(this, name);
    }
    this.addAnimationNamed = this.addAnimation;
    
    this.removeAnimation = function(name) {
      delete activeAnimations[name];
      var context = this.context || this;
      if (!Object.keys(activeAnimations).length) context.deregisterTarget(this);
    }
    this.removeAnimationNamed = this.removeAnimation;
    
    this.animationNamed = function(name) {
      var animation = activeAnimations[name];
      if (animation) return shallowCopyAnimation(animation);
      return null;
    }
    
    this.context = context;
    ShoeContext.call(this);
  }
  ShoeLayer.prototype = Object.create(ShoeContext.prototype);
  ShoeLayer.prototype.constructor = ShoeLayer;
  ShoeLayer.prototype.shoeAnimationForKey = function(key,value,target) {
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
    this.settings = settings;
    
    if (settings) Object.keys(settings).forEach( function(key) {
      this[key] = settings[key];
    }.bind(this));
    
    this.type = "value"; // awkward
    this[this.type] = this.zero();
    
    Object.defineProperty(this, this.type, {
      get: function() {
        if (this.startTime === null || this.startTime === undefined) return this.zero();
        if (!this.duration) return this.to; // I want delay etc
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
  
  function ShoeNumber(settings) {
    ShoeValue.call(this,settings);
  }
  ShoeNumber.prototype = Object.create(ShoeValue.prototype);
  ShoeNumber.prototype.zero = function() {
    return 0;
  };
  ShoeNumber.prototype.add = function(a,b) {
    return a + b;
  };
  ShoeNumber.prototype.invert = function(a) {
    return -a;
  };
  ShoeNumber.prototype.interpolate = function(a,b,progress) {
    return a + (b-a) * progress;
  };
  ShoeNumber.prototype.constructor = ShoeNumber;
  
  function ShoeScale(settings) {
    ShoeValue.call(this,settings);
  }
  ShoeScale.prototype = Object.create(ShoeValue.prototype);
  ShoeScale.prototype.zero = function() {
    return 1;
  };
  ShoeScale.prototype.add = function(a,b) {
    return a * b;
  };
  ShoeScale.prototype.invert = function(a) {
    if (a === 0) return 0;
    return 1/a;
  };
  ShoeScale.prototype.interpolate = function(a,b,progress) {
    return a + (b-a) * progress;
  };
  ShoeScale.prototype.constructor = ShoeScale;
  
  return {
    Layer : ShoeLayer,
    Context : ShoeContext,
    NumberType : ShoeNumber,
    ScaleType : ShoeScale,
    ValueType : ShoeValue
  }
})();