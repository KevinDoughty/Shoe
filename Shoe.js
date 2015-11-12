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
  
  function isNumber(w) {
    w = scientificToDecimal(w);
    return !isNaN(parseFloat(w)) && isFinite(w); // I want infinity for repeat count. Probably not duration
  }
  
  
  
  function ShoeTransaction(automaticallyCommit) {
    this.time = performance.now() / 1000; // value should probably be inherited from parent transaction
    this.disableAnimation = false; // value should probably be inherited from parent transaction
    this.layers = {}; // NOT IMPLEMENTED. Cache layers so you don't have to repeatedly calculate presentation values.
    this.automaticallyCommit = automaticallyCommit;
  }
  
  
  
  function ShoeContext() {
    this.targets = [];
    this.transactions = [];
    this.ticking = false;
  }
  
  ShoeContext.prototype = {
    _createTransaction: function(automaticallyCommit) {
      var transaction = new ShoeTransaction(automaticallyCommit);
      this.transactions.push(transaction);
      return transaction;
    },
    _currentTransaction: function() {
      var length = this.transactions.length;
      if (length) return this.transactions[length-1];
      return this._createTransaction(true);
    },
    beginTransaction: function() {
      this._createTransaction();
    },
    commitTransaction: function() {
      var transaction = this.transactions.pop();
    },
    disableAnimation: function(disable) {
      var transaction = this._currentTransaction();
      transaction.disableAnimation = disable;
      this._startTicking();
    },
    
    registerTarget: function(target) {
      if (!this.ticking) this._startTicking();
      var index = this.targets.indexOf(target);
      if (index < 0) this.targets.push(target);
    },
    
    deregisterTarget: function(target) {
      var index = this.targets.indexOf(target);
      if (index > -1) this.targets.splice(index, 1);
    },
    _startTicking: function() {
      if (!this.ticking) {
        this.ticking = true;
        raf(this.ticker.bind(this));
      }
    },
    ticker: function() {
      this.ticking = false;
      var length = this.transactions.length;
      if (length) {
        var transaction = this.transactions[length-1];
        if (transaction.automaticallyCommit) this.commitTransaction();
      }
      this.targets.forEach( function(target) {
        var render = target.render;
        if (isFunction(render)) {
          var layer = target.presentation || target;
          var boundRender = render.bind(layer);
          boundRender();
        }
      }.bind(this));
      if (this.targets.length) this._startTicking();
    }
  }
  var shoeContext = new ShoeContext();
  
  
  
  function ShoeLayer() { // Meant to be subclassed to provide implicit animation and clear distinction between model/presentation values
    var modelDict = {};
    var registeredProperties = [];
    var allAnimations = [];
    var namedAnimations = {};
    var defaultAnimations = {};
    //var animationCount = 0; // need to implement auto increment key
    var shouldSortAnimations = false;
    var animationNumber = 0; // order added
    
    this.implicitAnimation = function(property,value) {
      var animation;
      var description;
      var animationForKey = this.animationForKey;
      if (isFunction(animationForKey)) description = this.animationForKey(property,value,this); // If prototype chain is not properly constructed, Shoe.Layer animationForKey will not exist.
      var defaultAnimation = defaultAnimations[property];
      if (description && description instanceof ShoeValue) {
        animation = description.copy();
      } else if (description && typeof description === "object" && isFunction(defaultAnimation)) {
        animation = new defaultAnimation(description);
        if (!animation instanceof ShoeValue) animation = null;
      } else if (defaultAnimation instanceof ShoeValue) {
        animation = defaultAnimation.copy();
        if (description && typeof description === "object") {
          Object.keys(description).forEach( function(key) {
            animation[key] = description[key];
          });
        }
      }
      return animation;
    }
    
    this.registerAnimatableProperty = function(name, defaultValue) {
      registeredProperties.push(name);
      var defaultAnimation = defaultValue;
      if (isFunction(defaultValue)) defaultAnimation = new defaultValue();
      var descriptor = Object.getOwnPropertyDescriptor(this, name);
      if (descriptor && descriptor.configurable === false) {
        console.log("ShoeLayer:%s; registerAnimatableProperty:%s; already defined:%s;",this,name, JSON.stringify(descriptor),this);
        return;
      }
      if (defaultAnimation) defaultAnimations[name] = defaultAnimation;
      else if (defaultAnimations[name]) delete defaultAnimations[name]; // property is still animatable
      
      modelDict[name] = this[name];
      Object.defineProperty(this, name, { // ACCESSORS
        get: function() {
          if (this._isProxy) throw new Error("PresentationLayer getter should not be used for property:"+name+";");
          else return modelDict[name];
        },
        set: function(value) {
          if (this._isProxy) throw new Error("PresentationLayer setter should not be used for property:"+name+";");
          else {
            var animation;
            var transaction = this.context._currentTransaction();
            if (!transaction.disableAnimation) {
              animation = this.implicitAnimation(name,value);
              if (animation) {
                if (animation.property === null || animation.property === undefined) animation.property = name;
                if (animation.from === null || animation.from === undefined) {
                  if (animation.absolute === true || animation.blend === "absolute") animation.from = this.presentation[name]; // use presentation layer
                  else animation.from = modelDict[name];
                }
                if (animation.to === null || animation.to === undefined) animation.to = value;
                this.addAnimation(animation); // this will copy a second time. 
              }
            }
            modelDict[name] = value;
            if (!animation) { // need to manually call render on property value change without animation. transactions.
              var layer = this.presentation || this;
              if (isFunction(layer.render)) layer.render();
            }
          }
        }
      });
    }
    
    Object.defineProperty(this, "animations", {
      get: function() {
        return allAnimations.map(function (animation) {
          return animation.copy(); // Lots of copying. Potential optimization
        });
      }
    });
    Object.defineProperty(this, "animationKeys", {
      get: function() {
        return Object.keys(namedAnimations);
      }
    });
    
    var modelLayer = this;
    Object.defineProperty(this, "presentation", { // COMPOSITING. Rename "presentationLayer"? Have separate compositor object?
      get: function() { // need transactions and cache presentation layer
        //if (this._isProxy) return modelLayer;
        if (this._isProxy) return this; // need both presentationLayer and modelLayer getters
        
        var compositor = {};
        var finishedAnimations = [];
        var proxy = Object.create(this);
        proxy._isProxy = true; // do this differently. Maybe have presentationLayer and modelLayer accessors
        
        if (shouldSortAnimations) {
          allAnimations.sort( function(a,b) {
            var A = a.index, B = b.index;
            if (A === null || A === undefined) A = 0;
            if (B === null || B === undefined) B = 0;
            var result = A - B;
            if (!result) result = a.startTime - b.startTime;
            if (!result) result = a.number - b.number; // animation number is probably not necessary. Unsure about sort behavior.
            return result;
          });
          shouldSortAnimations = false;
        }
        
        var transaction = this.context._currentTransaction();
        var now = transaction.time;
        
        allAnimations.forEach( function(animation) {
          var property = animation.property;
          var value = animation.getAnimatedValue(now);
          var model = modelDict[property];
          var defaultAnimation = defaultAnimations[property];
          if (defaultAnimation instanceof ShoeValue && defaultAnimation.blend === "zero") model = defaultAnimation.zero();
          
          if (compositor[property] === null || compositor[property] === undefined) compositor[property] = model;
          
          if (animation.absolute === true) compositor[property] = value;
          else compositor[property] = animation.add(compositor[property],value);
          
          if (animation.finished === true) finishedAnimations.push(animation);
        }.bind(this));
        
        var compositorKeys = Object.keys(compositor);
        compositorKeys.forEach( function(property) {
          Object.defineProperty(proxy, property, {value:compositor[property]});
        }.bind(this));
        
        registeredProperties.forEach( function(property) {
          if (compositorKeys.indexOf(property) === -1) {
            var value = modelDict[property];
            var defaultAnimation = defaultAnimations[property];
            if (defaultAnimation instanceof ShoeValue && defaultAnimation.blend === "zero") value = defaultAnimation.zero();
            Object.defineProperty(proxy, property, {value:value});
          }
        }.bind(this));

        finishedAnimations.forEach( function(animation) {
          if (isFunction(animation.onend)) animation.onend();
        });
        
        return proxy;
      }
    });
    
    this.needsDisplay = function() {
      // NOT IMPLEMENTED, obviously
      // This should be used instead of directly calling render
    }
    
    this.addAnimation = function(animation,name) { // should be able to pass a description if type is registered
      //if (name === null || name === undefined) name = "" + animation.property + animationCount++; // need to implement auto increment key
      var context = this.context || this;
      if (!allAnimations.length) context.registerTarget(this);
      var copy = animation.copy();
      copy.number = animationNumber++;
      allAnimations.push(copy);
      if (name !== null && name !== undefined) {
        var previous = namedAnimations[name];
        if (previous) this._removeAnimationInstance(previous); // after pushing to allAnimations, so context doesn't stop ticking
        namedAnimations[name] = copy;
      }
      shouldSortAnimations = true;
      copy.runAnimation(this, name);
    }
    this.addAnimationNamed = this.addAnimation;
    
    this._removeAnimationInstance = function(animation) {
      var index = allAnimations.indexOf(animation);
      if (index > -1) {
        allAnimations.splice(index,1);
        shouldSortAnimations = true;
      }
      var context = this.context || this;
      if (!allAnimations.length) context.deregisterTarget(this);
    }
    this.removeAnimation = function(name) {
      var animation = namedAnimations[name];
      this._removeAnimationInstance(animation);
      delete namedAnimations[name];
    }
    this.removeAnimationNamed = this.removeAnimation;
    
    this.removeAllAnimations = function() {
      allAnimations = [];
      namedAnimations = {};
    }
    
    this.animationNamed = function(name) {
      var animation = namedAnimations[name];
      if (animation) return animation.copy();
      return null;
    }
    
    this.context = shoeContext; // awkward
  }
  ShoeLayer.prototype = {};
  ShoeLayer.prototype.constructor = ShoeLayer;
  ShoeLayer.prototype.animationForKey = function(key,value,target) {
    return null;
  };
  
  
  
  function GraphicsLayer() {
    // This should more closely resemble CALayer, ShoeLayer just focuses on animations and triggering them
    // This should have renderInContext: instead of render:
    // Provide frame and bounds, allow sublayers.
    // apply transforms.
    // all drawing into top level layer backed object that holds canvas.
    // Only top layer has a canvas element
  }
  
  
  
  function ShoeValue(settings) { // The base animation class
    if (this.constructor === ShoeValue) {
      throw new Error("Shoe.ValueType is an abstract base class.");
    }
    this.settings = settings;
    this.property; // string, property name
    this.from; // type specific. Subclasses must implement zero, invert, add, and interpolate
    this.to; // type specific. Subclasses must implement zero, invert, add, and interpolate
    this.completion; // NOT FINISHED. callback function, fires regardless of fillMode. Should rename. Should also implement didStart, maybe didTick, etc.
    this.duration; // float. Need to validate/ensure float >= 0. Defaults to 0.
    this.easing; // NOT FINISHED. currently callback function only, need cubic bezier and presets. Defaults to linear
    this.speed; // float. Defaults to 1. RECONSIDER. Pausing currently not possible like in Core Animation. Layers have speed, beginTime, timeOffset!
    this.iterations = 1; // float >= 0. Defaults to 1.
    this.autoreverse; // boolean. When iterations > 1. Easing also reversed. Maybe should be named "autoreverses", maybe should be camelCased
    this.fillMode; // string. Defaults to "none". NOT FINISHED. "forwards" and "backwards" are "both". maybe should be named "fill". maybe should just be a boolean
    this.absolute; // boolean. Defaults to false. DEPRECATED. Use blend instead
    this.index = 0; // float. Custom compositing order. Defaults to 0.
    this.delay; // NOT IMPLEMENTED
    this.blend = "relative"; // also "absolute" or "zero"
    this.finished = false;
    this.startTime; // float
    if (settings) Object.keys(settings).forEach( function(key) {
      this[key] = settings[key];
    }.bind(this));
    
    this.getAnimatedValue = function(now) {
      if (this.startTime === null || this.startTime === undefined) return this.zero();
      var elapsed = now - this.startTime;
      var speed = this.speed; // might make speed a property of layer, not animation, might not because no sublayers / layer hierarcy yet
      var iterationProgress = 1;
      var combinedProgress = 1;
      var iterationDuration = this.duration;
      var combinedDuration = iterationDuration * this.iterations;
      if (combinedDuration) {
        iterationProgress = elapsed * speed / iterationDuration;
        combinedProgress = elapsed * speed / combinedDuration;
      }
      if (combinedProgress >= 1) {
        iterationProgress = 1;
        this.finished = true;
      }
      var inReverse = 0; // falsy
      if (!this.finished) {
        if (this.autoreverse === true) inReverse = Math.floor(iterationProgress) % 2;
        iterationProgress = iterationProgress % 1; // modulus for iterations
      }
      if (inReverse) iterationProgress = 1-iterationProgress; // easing is also reversed
      if (isFunction(this.easing)) iterationProgress = this.easing(iterationProgress);
      else if (this.easing !== "linear") iterationProgress = 0.5-(Math.cos(iterationProgress * Math.PI) / 2);
      
      if (this.absolute === true) return this.interpolate(this.from,this.to,iterationProgress);
      return this.interpolate(this.delta,this.zero(),iterationProgress);
    }
    
    this.delta;
    this.onend;
    this.runAnimation = function(layer,key) {
      if (!this.duration) this.duration = 0; // need better validation. Currently is split across constructor, setter, and here
      if (this.speed === null || this.speed === undefined) this.speed = 1; // need better validation
      if (this.iterations === null || this.iterations === undefined) this.iterations = 1; // negative values have no effect
      if (this.absolute !== true && this.blend !== "absolute") this.delta = this.add(this.from,this.invert(this.to));
      this.onend = function() { // should swap the naming
        if (!this.fillMode || this.fillMode === "none") {
          if (key !== null && key !== undefined) layer.removeAnimationNamed(key);
          else layer._removeAnimationInstance(this);
        }
        if (isFunction(this.completion)) this.completion();
        this.onend = null; // lazy way to keep compositor from calling this twice, during fill phase
      }.bind(this);
      if (this.startTime === null || this.startTime === undefined) this.startTime = performance.now() / 1000;
    }
  }
  ShoeValue.prototype = {
    copy: function() {
      //return Object.create(this);
      var constructor = this.constructor;
      var copy = new constructor(this.settings);
      var keys = Object.getOwnPropertyNames(this);
      var length = keys.length;
      for (var i = 0; i < length; i++) {
        Object.defineProperty(copy, keys[i], Object.getOwnPropertyDescriptor(this, keys[i]));
      }
      return copy;
    },
    zero: function() {
      throw new Error("Shoe.ValueType subclasses must implement function: zero()");
    },
    invert: function() {
      throw new Error("Shoe.ValueType subclasses must implement function: invert(a)");
    },
    add: function() {
      throw new Error("Shoe.ValueType subclasses must implement function: add(a,b)");
    },
    interpolate: function() {
      throw new Error("Shoe.ValueType subclasses must implement function: interpolate(a,b,progress)");
    }
  }
  
  
  
  function ShoeNumber(settings) {
    ShoeValue.call(this,settings);
  }
  ShoeNumber.prototype = Object.create(ShoeValue.prototype);
  ShoeNumber.prototype.constructor = ShoeNumber;
  ShoeNumber.prototype.zero = function() {
    return 0;
  };
  ShoeNumber.prototype.invert = function(a) {
    return -a;
  };
  ShoeNumber.prototype.add = function(a,b) {
    return a + b;
  };
  ShoeNumber.prototype.interpolate = function(a,b,progress) {
    return a + (b-a) * progress;
  };
  
  
  
  function ShoeScale(settings) {
    ShoeValue.call(this,settings);
  }
  ShoeScale.prototype = Object.create(ShoeValue.prototype);
  ShoeScale.prototype.constructor = ShoeScale;
  ShoeScale.prototype.zero = function() {
    return 1;
  };
  ShoeScale.prototype.invert = function(a) {
    if (a === 0) return 0;
    return 1/a;
  };
  ShoeScale.prototype.add = function(a,b) {
    return a * b;
  };
  ShoeScale.prototype.interpolate = function(a,b,progress) {
    return a + (b-a) * progress;
  };
  
  
  
  function ShoeArray(type,length,settings) {
    Shoe.ValueType.call(this,settings);
    this.type = type;
    if (isFunction(type)) this.type = new type(settings);
    this.length = length;
  }
  ShoeArray.prototype = Object.create(ShoeValue.prototype);
  ShoeArray.prototype.constructor = ShoeArray;
  ShoeArray.prototype.zero = function() {
    var array = [];
    var i = this.length;
    while (i--) array.push(this.type.zero());
    return array;
  };
  ShoeArray.prototype.add = function(a,b) {
    var array = [];
    for (var i = 0; i < this.length; i++) {
      array.push(this.type.add(a[i],b[i]));
    }
    return array;
  };
  ShoeArray.prototype.invert = function(a) {
    var array = [];
    for (var i = 0; i < this.length; i++) {
      array.push(this.type.invert(a[i]));
    }
    return array;
  };
  ShoeArray.prototype.interpolate = function(a,b,progress) {
    var array = [];
    for (var i = 0; i < this.length; i++) {
      array.push(this.type.interpolate(a[i],b[i],progress));
    }
    return array;
  };
  
  
  
  return {
    Layer : ShoeLayer,
    NumberType : ShoeNumber,
    ScaleType : ShoeScale,
    ValueType : ShoeValue,
    ArrayType : ShoeArray,
    beginTransaction: shoeContext.beginTransaction.bind(shoeContext),
    commitTransaction: shoeContext.commitTransaction.bind(shoeContext),
    disableAnimation: shoeContext.disableAnimation.bind(shoeContext)
  }
})();