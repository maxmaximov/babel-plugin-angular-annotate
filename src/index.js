export default function ({ Plugin, types: t }) {
  const TYPES = /(controller|config|service|filter|animation|provider|directive|factory|run)/;

  let directiveControllerVisitor = {
    Property() {
      if (this.get('key').isIdentifier({ name: 'controller' })) {
        annotateFunction(this.get('value'));
      }
    }
  };

  let providerGetVisitor = {
    ExpressionStatement() {
      if (this.get('expression.left').matchesPattern('this.$get')) {
        annotateFunction(this.get('expression.right'));
        this.stop();
      }
    }
  };

  function findRootDeclarator(path) {
    if (path.isIdentifier()) {
      let binding = path.scope.getBinding(path.node.name);

      if (binding) {
        let bpath = binding.path;

        if (bpath.isVariableDeclarator()) {
          if (bpath.get('init').isIdentifier()) {
            return findRootDeclarator(bpath.get('init'));
          } else {
            return bpath;
          }
        }

        if (bpath.isFunctionDeclaration() || bpath.isClassDeclaration() || bpath.isIdentifier()) {
          return bpath;
        }
      }
    }
  }

  function isAngularModule(path) {
    if (path.isMemberExpression()) {
      if (path.matchesPattern('angular.module')) {
        annotateModuleConfigFunction(path);
        return true;
      }
      let object = path.get('object');
      let declarator = findRootDeclarator(object);
      if (declarator && declarator.get('init').isCallExpression() && declarator.get('init.callee.object').isCallExpression()) {
        return declarator.get('init.callee.object.callee').matchesPattern('angular.module');
      }
      if (object.isCallExpression()) {
        return isAngularModule(object.get('callee'));
      }
    }
    return false;
  }

  function getTypeName(path) {
    return path.node.callee.property.name;
  }

  function getFunctionExpressionFromConstructor(classPath) {
    let functionExpression;
    let visitor = {
      MethodDefinition() {
        if (this.node.kind === 'constructor') {
          functionExpression = this.get('value');
          this.stop();
        }
      }
    };
    classPath.traverse(visitor);
    return functionExpression;
  }

  function isAnnotationCandidate(path) {
    return path.isCallExpression() && TYPES.test(getTypeName(path));
  }

  function annotateFunctionImpl(func, original) {
    if (!func) { return; }

    if (func.isFunctionExpression() || func.isFunctionDeclaration()) {
      let varLiterals = func.node.params.map(i => t.literal(i.name));
      varLiterals.push(original.node);
      original.replaceWith(
        t.arrayExpression(varLiterals)
      );
    }

    if (func.isClassDeclaration()) {
      let functionExpression = getFunctionExpressionFromConstructor(func);
      annotateFunctionImpl(functionExpression, original);
    }

    if (func.isIdentifier()) {
      let declarator = findRootDeclarator(func);
      if (declarator) {
        if (declarator.isVariableDeclarator()) {
          annotateFunctionImpl(declarator.get('init'), original);
        } else {
          annotateFunctionImpl(declarator, original);
        }
      }
    }
  }

  function matchesPattern(memberExprPath, identifierName, methodName, chained = false) {
    if (!memberExprPath.get('property').isIdentifier({ name: methodName })) {
      return false;
    }
    let object = memberExprPath.get('object');

    if (chained) {
      while (object.isCallExpression()) {
        if (object.get('callee').isMemberExpression()) {
          object = object.get('callee.object');
        }
      }
    }

    let declarator = findRootDeclarator(object);
    return declarator && declarator.isIdentifier({ name: identifierName });
  }

  function annotateInjectorInvoke(memberExprPath) {
    if (matchesPattern(memberExprPath, '$injector', 'invoke')) {
      let func = last(memberExprPath.parentPath.get('arguments'));
      annotateFunction(func);
    }
  }

  function eachObjectPropery(objectOrIdentifier, callback) {
    let object;

    if (objectOrIdentifier.isObjectExpression()) {
      object = objectOrIdentifier;
    }

    if (!object) {
      let declarator = findRootDeclarator(objectOrIdentifier);
      if (declarator.get('init').isObjectExpression()) {
        object = declarator.get('init');
      }
    }

    if (object) {
      let properties = object.get('properties');
      for (let i = 0; i < properties.length; i++) {
        let property = properties[i];
        callback(property);
      }
    }
  }

  // TODO this should likely be a plugin stuff
  function annotateRouteProviderWhen(memberExprPath) {
    if (matchesPattern(memberExprPath, '$routeProvider', 'when')) {
      let routeConfig = last(memberExprPath.parentPath.get('arguments'));
      eachObjectPropery(routeConfig, property => {
        if (property.get('key').isIdentifier({ name: 'resolve' })) {
          annotateObjectProperties(property.get('value'));
        } else if (property.get('key').isIdentifier({ name: 'controller' })) {
          annotateFunction(property.get('value'));
        }
      });
    }
  }

  function annotateStateProvider(memberExprPath) {
    if (matchesPattern(memberExprPath, '$stateProvider', 'state', true)) {
      let routeConfig = last(memberExprPath.parentPath.get('arguments'));
      eachObjectPropery(routeConfig, property => {
        if (property.get('key').isIdentifier({ name: 'resolve' })) {
          annotateObjectProperties(property.get('value'));
        } else if (property.get('key').isIdentifier({ name: 'controller' }) ||
                   property.get('key').isIdentifier({ name: 'onEnter' }) ||
                   property.get('key').isIdentifier({ name: 'onExit' })) {
          annotateFunction(property.get('value'));
        }
      });
    }
  }

  function annotateProvide(memberExprPath) {
    let types = ['decorator', 'service', 'factory', 'provider'];
    let matchedType;

    function matchesProvide(type) {
      if (matchesPattern(memberExprPath, '$provide', type)) {
        matchedType = type;
        return true;
      }
    }

    if (types.some(matchesProvide)) {
      let func = last(memberExprPath.parentPath.get('arguments'));
      annotateFunction(func);
      if (matchedType === 'provider') {
        func.traverse(providerGetVisitor);
      }
    }
  }

  function annotateHttpProviderInterceptors(memberExprPath) {
    if (matchesPattern(memberExprPath, '$httpProvider', 'interceptors')) {
      if (memberExprPath.parentPath.get('property').isIdentifier({ name: 'push' })) {
        let func = memberExprPath.parentPath.parentPath.get('arguments')[0];
        annotateFunction(func);
      }
    }
  }

  function annotateFunction(path) {
    return annotateFunctionImpl(path, path);
  }

  function annotateObjectProperties(object) {
    if (!object.isObjectExpression()) { return; }
    let properties = object.get('properties');
    for (let i = 0; i < properties.length; i++) {
      let property = properties[i];
      annotateFunction(property.get('value'));
    }
  }

  function last(array) {
    return array[array.length-1];
  }

  function annotateModuleConfigFunction(path) {
    let moduleLastArg = last(path.parentPath.get('arguments'));
    annotateFunction(moduleLastArg);
  }

  function annotateModuleType(memberExprPath) {
    let annotationCandidate = memberExprPath.findParent(isAnnotationCandidate);
    if (annotationCandidate) {
      let candidate = last(annotationCandidate.get('arguments'));

      annotateFunction(candidate);

      switch (getTypeName(annotationCandidate)) {
      case 'provider':
        candidate.traverse(providerGetVisitor);
        break;
      case 'directive':
        candidate.traverse(directiveControllerVisitor);
        break;
      }
    }
  }

  return new Plugin('angular-annotate', {
    visitor: {
      MemberExpression() {
        if (isAngularModule(this)) {
          annotateModuleType(this);
        }
        annotateInjectorInvoke(this);
        annotateRouteProviderWhen(this);
        annotateStateProvider(this);
        annotateHttpProviderInterceptors(this);
        annotateProvide(this);
      }
    }
  });
}
