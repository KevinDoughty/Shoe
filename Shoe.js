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
  
  var rAF = window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.msRequestAnimationFrame ||
    window.oRequestAnimationFrame;
    
  var cAF = window.cancelAnimationFrame ||
    window.webkitCancelRequestAnimationFrame ||
    window.webkitCancelAnimationFrame ||
    window.mozCancelAnimationFrame ||
    window.msCancelAnimationFrame ||
    window.oCancelAnimationFrame;
  
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
    this.frame;
  }
  
  ShoeContext.prototype = {
    _createTransaction: function(automaticallyCommit) {
      var transaction = new ShoeTransaction(automaticallyCommit);
      var length = this.transactions.length;
      if (length) { // Time freezes in transactions. A time getter should return transaction time if within one.
        transaction.time = this.transactions[length-1].time;
      }
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
    flushTransaction: function() {
      if (this.frame) cAF(this.frame); // Unsure if cancelling animation frame is needed.
      this.ticker(); // Probably should not commit existing transaction
    },
    disableAnimation: function(disable) {
      var transaction = this._currentTransaction();
      transaction.disableAnimation = disable;
      this._startTicking();
    },
    
    registerTarget: function(target) {
      this._startTicking();
      var index = this.targets.indexOf(target);
      if (index < 0) this.targets.push(target);
    },
    
    deregisterTarget: function(target) {
      var index = this.targets.indexOf(target);
      if (index > -1) this.targets.splice(index, 1);
    },
    _startTicking: function() {
      if (!this.frame) this.frame = rAF(this.ticker.bind(this));
    },
    ticker: function() { // Need to manually cancel animation frame if calling directly.
      this.frame = undefined;
      var targets = this.targets.slice(0);
      targets.forEach( function(target) {
        if (!target.animations.length) this.deregisterTarget(target); // Deregister here to ensure one more tick after last animation has been removed
        var render = target.render;
        if (isFunction(render)) {
          var layer = target.presentation || target;
          var boundRender = render.bind(layer);
          boundRender();
        }
      }.bind(this));
      var length = this.transactions.length;
      if (length) {
        var transaction = this.transactions[length-1];
        if (transaction.automaticallyCommit) this.commitTransaction();
      }
      if (this.targets.length) this._startTicking();
    }
  }
  var shoeContext = new ShoeContext();
  
  
  
  function Layerize(receiver) {
    var modelDict = {};
    var registeredProperties = [];
    var allAnimations = [];
    var namedAnimations = {};
    var defaultAnimations = {};
    //var animationCount = 0; // need to implement auto increment key
    var shouldSortAnimations = false;
    var animationNumber = 0; // order added
    
    var implicitAnimation = function(property,value) {
      var animation;
      var description;
      var animationForKey = receiver.animationForKey;
      if (isFunction(animationForKey)) description = receiver.animationForKey(property,value,receiver); // If prototype chain is not properly constructed, Shoe.Layer animationForKey will not exist.
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
    
    var valueForKey = function(property) {
      return modelDict[property];
    };
    
    var setValueForKey = function(value,property) {
      var animation;
      var transaction = shoeContext._currentTransaction();
      if (!transaction.disableAnimation) {
        animation = implicitAnimation(property,value);
        if (animation) {
          if (animation.property === null || animation.property === undefined) animation.property = property;
          if (animation.from === null || animation.from === undefined) {
            if (animation.blend === "absolute") animation.from = receiver.presentation[property]; // use presentation layer
            else animation.from = modelDict[property];
          }
          if (animation.to === null || animation.to === undefined) animation.to = value;
          receiver.addAnimation(animation); // this will copy a second time. 
        }
      }
      modelDict[property] = value;
      if (!animation) { // need to manually call render on property value change without animation. transactions.
        var layer = receiver.presentation || receiver;
        if (isFunction(layer.render)) layer.render();
      }
    };
    
    receiver.registerAnimatableProperty = function(property, defaultValue) {
      registeredProperties.push(property);
      var defaultAnimation = defaultValue;
      if (isFunction(defaultValue)) defaultAnimation = new defaultValue();
      var descriptor = Object.getOwnPropertyDescriptor(receiver, property);
      if (descriptor && descriptor.configurable === false) {
        console.log("ShoeLayer:%s; registerAnimatableProperty:%s; already defined:%s;",receiver,property, JSON.stringify(descriptor),receiver);
        return;
      }
      if (defaultAnimation) defaultAnimations[property] = defaultAnimation;
      else if (defaultAnimations[property]) delete defaultAnimations[property]; // property is still animatable
      modelDict[property] = receiver[property];
      Object.defineProperty(receiver, property, { // ACCESSORS
        get: function() {
          if (receiver._isProxy) throw new Error("PresentationLayer getter should not be used for property:"+property+";");
          else return valueForKey(property);
        },
        set: function(value) {
          if (receiver._isProxy) throw new Error("PresentationLayer setter should not be used for property:"+property+";");
          else setValueForKey(value,property);
        },
        enumerable: true,
        configurable: false
      });
    }
    
    Object.defineProperty(receiver, "animations", {
      get: function() {
        return allAnimations.map(function (animation) {
          return animation.copy(); // Lots of copying. Potential optimization
        });
      },
      enumerable: false,
      configurable: false
    });
    Object.defineProperty(receiver, "animationKeys", {
      get: function() {
        return Object.keys(namedAnimations);
      },
      enumerable: false
    });
    
    var modelLayer = receiver;
    Object.defineProperty(receiver, "presentation", { // COMPOSITING. Rename "presentationLayer"? Have separate compositor object?
      get: function() { // need transactions and cache presentation layer
        //if (receiver._isProxy) return modelLayer;
        if (receiver._isProxy) return receiver; // need both presentationLayer and modelLayer getters
        
        var compositor = Object.keys(modelDict).reduce(function(n, k){ n[k] = modelDict[k]; return n;}, {});
        Object.keys(compositor).forEach( function(property) {
          var defaultAnimation = defaultAnimations[property];
          if (defaultAnimation instanceof ShoeValue && defaultAnimation.blend === "zero") compositor[property] = defaultAnimation.zero(); // blend mode zero has conceptual difficulties. Animations affect layers in ways beyond what an animation should. zero presentation is more of a layer property, not animation. Default animation is the only thing that can be used. Can't do this from animationForKey
        });
        var finishedAnimations = [];
        var proxy = Object.create(receiver);
        proxy._isProxy = receiver; // do this differently. Maybe have presentationLayer and modelLayer accessors
        
        if (shouldSortAnimations) {
          allAnimations.sort( function(a,b) {
            var A = a.index, B = b.index;
            if (A === null || A === undefined) A = 0;
            if (B === null || B === undefined) B = 0;
            var result = A - B;
            if (!result) result = a.startTime - b.startTime;
            if (!result) result = a.number - b.number; // animation number is needed because sort is not guaranteed to be stable
            return result;
          });
          shouldSortAnimations = false;
        }
        
        var transaction = shoeContext._currentTransaction();
        var now = transaction.time;
        
        allAnimations.forEach( function(animation) {
          animation.composite(compositor,now);
          //if (animation.finished === true) finishedAnimations.push(animation);
          if (animation.finished > 1) throw new Error("Animation finishing twice is not possible");
          if (animation.finished > 0) finishedAnimations.push(animation);
        }.bind(this));
        
        var compositorKeys = Object.keys(compositor);
        compositorKeys.forEach( function(property) {
          Object.defineProperty(proxy, property, {value:compositor[property]});
        }.bind(receiver));
        
        registeredProperties.forEach( function(property) {
          if (compositorKeys.indexOf(property) === -1) {
            var value = modelDict[property];
            var defaultAnimation = defaultAnimations[property]; // Blend mode zero suffers from conceptual difficulties. don't want to ask for animationForKey again. need to determine presentation value
            if (defaultAnimation instanceof ShoeValue && defaultAnimation.blend === "zero") value = defaultAnimation.zero();
            Object.defineProperty(proxy, property, {value:value});
          }
        }.bind(receiver));
        
        finishedAnimations.forEach( function(animation) {
          if (isFunction(animation.onend)) animation.onend();
        });
        
        return proxy;
      },
      enumerable: false,
      configurable: false
    });
    
    /*
    receiver.needsDisplay = function() {
      // This should be used instead of directly calling render
    }
    */
    var removeAnimationInstance = function(animation) {
      var index = allAnimations.indexOf(animation);
      if (index > -1) allAnimations.splice(index,1); // do not deregister yet, must ensure one more tick
    }
    
    var removalCallback = function(animation,key) {
      if (key !== null && key !== undefined) receiver.removeAnimation(key);
      else removeAnimationInstance(animation);
    }
    
    receiver.addAnimation = function(animation,name) { // should be able to pass a description if type is registered
      //if (name === null || name === undefined) name = "" + animation.property + animationCount++; // need to implement auto increment key
      if (!animation instanceof ShoeValue) throw new Error("Animations must be a subclass of Shoe.ValueType.");
      if (!allAnimations.length) shoeContext.registerTarget(receiver);
      var copy = animation.copy();
      copy.number = animationNumber++;
      allAnimations.push(copy);
      if (name !== null && name !== undefined) {
        var previous = namedAnimations[name];
        if (previous) removeAnimationInstance(previous); // after pushing to allAnimations, so context doesn't stop ticking
        namedAnimations[name] = copy;
      }
      shouldSortAnimations = true;
      copy.runAnimation(receiver, name, removalCallback);
    }
    
    receiver.removeAnimation = function(name) {
      var animation = namedAnimations[name];
      removeAnimationInstance(animation);
      delete namedAnimations[name];
    }
    
    receiver.removeAllAnimations = function() {
      allAnimations = [];
      namedAnimations = {};
    }
    
    receiver.animationNamed = function(name) {
      var animation = namedAnimations[name];
      if (animation) return animation.copy();
      return null;
    }
  }
  
  
  
  function ShoeLayer() { // Meant to be subclassed to provide implicit animation and clear distinction between model/presentation values
    Layerize(this);
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
    if (this instanceof ShoeValue === false) {
      throw new Error("ShoeValue is a constructor, not a function. Do not call it directly.");
    }
    if (this.constructor === ShoeValue) {
      throw new Error("Shoe.ValueType is an abstract base class.");
    }
    this.settings = settings;
    this.property; // string, property name
    this.from; // type specific. Subclasses must implement zero, add, subtract and interpolate. invert is no longer used
    this.to; // type specific. Subclasses must implement zero, add, subtract and interpolate. invert is no longer used
    this.completion; // NOT FINISHED. callback function, fires regardless of fillMode. Should rename. Should also implement didStart, maybe didTick, etc.
    this.duration = 0.0; // float. In seconds. Need to validate/ensure >= 0.
    this.easing; // NOT FINISHED. currently callback function only, need cubic bezier and presets. Defaults to linear
    this.speed = 1.0; // float. RECONSIDER. Pausing currently not possible like in Core Animation. Layers have speed, beginTime, timeOffset!
    this.iterations = 1; // float >= 0.
    this.autoreverse; // boolean. When iterations > 1. Easing also reversed. Maybe should be named "autoreverses", maybe should be camelCased
    this.fillMode; // string. Defaults to "none". NOT FINISHED. "forwards" and "backwards" are "both". maybe should be named "fill". maybe should just be a boolean
    this.index = 0; // float. Custom compositing order.
    this.delay = 0; // float. In seconds.
    this.blend = "relative"; // also "absolute" or "zero"
    this.additive = true;
    this.sort;
    this.finished = 0;//false;
    this.startTime; // float
    this.delta;
    this.onend;
    
    if (settings) Object.keys(settings).forEach( function(key) {
      this[key] = settings[key];
    }.bind(this));
    
    //this.getAnimatedValue = function(now) {
    this.composite = function(onto,now) {
      if (this.startTime === null || this.startTime === undefined) return this.zero();
      var elapsed = Math.max(0, now - (this.startTime + this.delay));
      var speed = this.speed; // might make speed a property of layer, not animation, might not because no sublayers / layer hierarcy yet. Part of GraphicsLayer.
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
        this.finished++;// = true;
      }
      var inReverse = 0; // falsy
      if (!this.finished) {
        if (this.autoreverse === true) inReverse = Math.floor(iterationProgress) % 2;
        iterationProgress = iterationProgress % 1; // modulus for iterations
      }
      if (inReverse) iterationProgress = 1-iterationProgress; // easing is also reversed
      if (isFunction(this.easing)) iterationProgress = this.easing(iterationProgress);
      else if (this.easing !== "linear") iterationProgress = 0.5-(Math.cos(iterationProgress * Math.PI) / 2);
      
      var value;
      if (this.blend === "absolute") value = this.interpolate(this.from,this.to,iterationProgress);
      //return this.interpolate(this.delta,this.zero(),iterationProgress);
      else value = this.interpolate(this.delta,this.zero(),iterationProgress);
      var property = this.property;
      //var value = animation.getAnimatedValue(now); // group animation ? active animation
      if (this.additive) onto[property] = this.add(onto[property],value);
      else onto[property] = value;
    }
    
    this.runAnimation = function(layer,key,removalCallback) {
      if (!this.duration) this.duration = 0.0; // need better validation. Currently is split across constructor, setter, and here
      if (this.speed === null || this.speed === undefined) this.speed = 1; // need better validation
      if (this.iterations === null || this.iterations === undefined) this.iterations = 1; // negative values have no effect
      if (this.blend !== "absolute") this.delta = this.subtract(this.from,this.to);
      this.onend = function() { // COMPLETION. Should swap the naming. Private should be completion, public should be onend or onEnd
        if (!this.fillMode || this.fillMode === "none") {
          removalCallback(this,key);
        }
        if (isFunction(this.completion)) this.completion();
        this.onend = null; // lazy way to keep compositor from calling this twice, during fill phase
      }.bind(this);
      if (this.startTime === null || this.startTime === undefined) this.startTime = shoeContext._currentTransaction().time;
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
    validate: function(value) {
      return true;
    },
    zero: function() {
      throw new Error("Shoe.ValueType subclasses must implement function: zero()");
    },
    add: function() {
      throw new Error("Shoe.ValueType subclasses must implement function: add(a,b)");
    },
    subtract: function() {
      throw new Error("Shoe.ValueType subclasses must implement function: subtract(a,b) in the form subtract b from a");
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
  ShoeNumber.prototype.add = function(a,b) {
    return a + b;
  };
  ShoeNumber.prototype.subtract = function(a,b) { // subtract b from a
    return a - b;
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
  ShoeScale.prototype.add = function(a,b) {
    return a * b;
  };
  ShoeScale.prototype.subtract = function(a,b) { // subtract b from a
    if (b === 0) return 0;
    return a/b;
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
  ShoeArray.prototype.subtract = function(a,b) { // subtract b from a
    var array = [];
    for (var i = 0; i < this.length; i++) {
      array.push(this.type.subtract(a[i],b[i]));
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
  
  
  
  function ShoeSet(settings) {
    ShoeValue.call(this,settings);
  }
  ShoeSet.prototype = Object.create(ShoeValue.prototype);
  ShoeSet.prototype.constructor = ShoeSet;
  ShoeSet.prototype.zero = function() {
    return [];
  };
  ShoeSet.prototype.add = function(a,b) {
    if (!Array.isArray(a) && !Array.isArray(b)) return [];
    if (!Array.isArray(a)) return b;
    if (!Array.isArray(b)) return a;
    var array = a.slice(0);
    var i = b.length;
    while (i--) {
      if (a.indexOf(b[i]) < 0) array.push(b[i]);
    }
    if (this.sort === true) array.sort(); //Array.sort default is by unicode codepoint
    if (this.sort && isFunction(this.sort)) array.sort(this.sort); // consider sorting during subtract
    return array;
  };
  ShoeSet.prototype.subtract = function(a,b) { // remove b from a
    if (!Array.isArray(a) && !Array.isArray(b)) return [];
    if (!Array.isArray(a)) return b;
    if (!Array.isArray(b)) return a;
    var array = a.slice(0);
    var i = b.length;
    while (i--) {
      var loc = array.indexOf(b[i]);
      if (loc > -1) array.splice(loc,1);
    }
    return array;
  };
  ShoeSet.prototype.interpolate = function(a,b,progress) {
    if (progress >= 1) return b;
    return a;
  };
  
  
  
  return {
    Layer: ShoeLayer, // The basic layer class, meant to be subclassed
    ValueType: ShoeValue, // Abstract animation base class
    NumberType: ShoeNumber, // For animating numbers
    ScaleType: ShoeScale, // For animating transform scale
    ArrayType: ShoeArray, // For animating arrays of other value types
    SetType: ShoeSet, // Discrete object changes
    beginTransaction: shoeContext.beginTransaction.bind(shoeContext),
    commitTransaction: shoeContext.commitTransaction.bind(shoeContext),
    flushTransaction: shoeContext.flushTransaction.bind(shoeContext),
    disableAnimation: shoeContext.disableAnimation.bind(shoeContext),
    layerize: Layerize // To mixin layer functionality in objects that are not ShoeLayer subclasses.
  }
})();