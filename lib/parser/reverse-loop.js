var Context = require('../context');

// TODO: This file repeats itself too often. Is there any way to consolidate these nested loops?

function useExistingVariable(context, token, tokens, dfs) {
  // Establish variable values
  var name = token[1];
  var subtokens = token[4];
  var val = context.getToken(name);

  // If the item is not an array (e.g. object/string), upcast it to one
  // DEV: This allows for looping items (and we will never have an array generated by other means)
  // TODO: What about a user providing pre-existing data?
  if (!Array.isArray(val)) {
    val = [val];
  }

  // Backing off on a per-character basis
  var contentToMatch = context.remainingContent;
  var i = contentToMatch.length;
  for (; i > 0; i -= 1) {
    // Get the content we are going to try to match
    var remainingContent = contentToMatch.slice(0, i);

    // For each of the items
    var items = val;
    var j = 0;
    var jLen = items.length;
    var matchContexts = [];
    for (; j < jLen; j += 1) {
      // Generate a context to match against (clean because of nested tokens)
      var item = items[j];
      var matchContext = new Context(remainingContent);

      // If this is an object
      // TODO: Is it possible for this to be an array?
      if (typeof item === 'object') {
        // TODO: We should test this (probably handled by extend case on master)
        var keys = Object.getOwnPropertyNames(item);
        keys.forEach(function (key) {
          matchContext.setToken(key, item);
        });
      // Otherwise, define `.` as the item
      } else {
        matchContext.setToken('.', item);
      }

      // Attempt to match
      var proposedMatchContext = dfs(matchContext, subtokens);

      // If we could not match, break
      // DEV: It could not match due to the backoff logic we are performing
      if (!proposedMatchContext) {
        break;
      // Otherwise, save the match and trim remaining content
      } else {
        matchContexts.push(proposedMatchContext);
        remainingContent = remainingContent.slice(proposedMatchContext.completedContent.length);
      }
    }

    // If we stopped early, continue
    if (matchContexts.length !== items.length) {
      continue;
    }

    // TODO: Re-interpret matchContext values
    // TODO: Don't forget to downcast single items
    // DEV: We do this in case of new token values being introduced (e.g. via extend)
    var proposedContext = context.clone();
    var proposedVal = matchContexts.map(function (matchContext) {
      // Save the amount of content they completed
      proposedContext.addStr(matchContext.completedContent);

      // Map the matches into their respective flavors (e.g. `object`, `.`, `true`)
      var tokensByName = matchContext.tokensByName;
      if (Object.getOwnPropertyNames(tokensByName).length) {
        // If there is a `.` key, make that our return value
        var retVal = tokensByName;
        if (tokensByName['.'] !== undefined) {
          retVal = tokensByName['.'];
        }
        return retVal;
      } else {
        return true;
      }
    });
    // If there is only one item, go for lower common denominator
    if (items.length === 1) {
      proposedVal = proposedVal[0];
    }

    // Match remaining content
    proposedContext.setToken(name, proposedVal, true);
    var resultContext = dfs(proposedContext, tokens.slice(1));

    // If we matched, return the result
    if (resultContext) {
      return resultContext;
    }
  }

  // If none of the string slices matched, return failure
  return null;
}

function defineVariable(context, token, tokens, dfs) {
  // Match internal content as many times as possible
  var name = token[1];
  var subcontext = new Context(context.remainingContent);
  var subresultContextArr = [];
  var subtokens = token[4];
  var lastRemainingContent;
  while (true) {
    // Break the context reference to avoid alteration to stored result
    subcontext = subcontext.clone();

    // Attempt to match the content again
    // DEV: We do not set the variable value here to allow inner-loops to extend as far as they can then cut back when forcing values later on
    // TODO: Don't forget that this runs in its own sub-object context (yey)
    var subresultContext = dfs(subcontext, subtokens);

    // If we could not match or we have not made progress, stop looping
    if (!subresultContext || subresultContext.remainingContent.length === lastRemainingContent) {
      break;
    }

    // Otherwise, save the subresult context
    lastRemainingContent = subresultContext.remainingContent.length;
    subresultContextArr.push(subresultContext);
    subcontext = subresultContext;
  }

  // If the content matched, attempt to save our boolean as true
  // DEV: We make this as an attempt because future content could be invalid
  if (subresultContextArr.length) {
    // Attempt to use the entire array but progressively backoff
    var i = subresultContextArr.length;
    for (; i > 0; i -= 1) {
      // Attempt to use the entire string but progressively backoff
      // TODO: This runtime is horrible; n^n if every character is a variable
      // DEV: We must do this in case of `{{#world}}{{hai}}{{/world}} hai`
      // TODO: If there are no variables in the loop, we can skip this (it must be the entirety)
      var subresultContext = subresultContextArr[i - 1];
      var j = subresultContext.completedContent.length;
      for (; j > 0; j -= 1) {
        // TODO: If we are on the total length, use `subresultContextArr[i]` for `matchContexts` as it is pre-calculated. Also, fix it first to match this pattern.

        // Match each loop iteration (the `token` loop, not these other 3 ones -_-)
        var remainingContent = subresultContext.completedContent.slice(0, j);
        var k = i - 1; // Offset by 1 so we can have k >= 0 which makes more sense in the array sense
        var matchContexts = [];
        for (; k >= 0; k -=1) {
          // Run the match
          var matchContext = new Context(remainingContent);
          var proposedMatchContext = dfs(matchContext, subtokens);

          // If we cannot match, break the loop
          if (!proposedMatchContext) {
            break;
          // Otherwise, save the context and trim the remaining content
          } else {
            // TODO: We will probably need to progressively back off here recursively as well. fuck.
            // TODO: How do you back off the first variable but not the third? I don't think it is possible.
            matchContexts.push(proposedMatchContext);
            remainingContent = remainingContent.slice(proposedMatchContext.completedContent.length);
          }
        }

        // If we stopped early, continue
        if (matchContexts.length !== i) {
          continue;
        }

        // For each of our match contexts
        var proposedContext = context.clone();
        var proposedVal = matchContexts.map(function (matchContext) {
          // Save the amount of content they completed
          proposedContext.addStr(matchContext.completedContent);

          // Map the matches into their respective flavors (e.g. `object`, `.`, `true`)
          var tokensByName = matchContext.tokensByName;
          if (Object.getOwnPropertyNames(tokensByName).length) {
            // If there is a `.` key, make that our return value
            var retVal = tokensByName;
            if (tokensByName['.'] !== undefined) {
              retVal = tokensByName['.'];
            }
            return retVal;
          } else {
            return true;
          }
        });

        // If there is only one item, go for lower common denominator
        // TODO: Is there a conflict between setting either `place[0]` vs `place` (maybe if someone has `[object Array]` -_-;;)
        if (i === 1) {
          proposedVal = proposedVal[0];
        }

        // Attempt to use our set of tokens on the remaining content
        proposedContext.setToken(name, proposedVal);
        var resultContext = dfs(proposedContext, tokens.slice(1));

        // If we matched, return
        if (resultContext) {
          return resultContext;
        }
      }
    }

    // Otherwise, continue to false
  }

  // Mark the boolean as false
  // DEV: This will fail on future steps if it is not `false` either
  var proposedContext = context.clone();
  proposedContext.setToken(name, false);
  var resultContext = dfs(proposedContext, tokens.slice(1));
  return resultContext;
}

module.exports = function parserLoop (context, token, tokens, dfs) {
  // If we already have the value, use it
  var name = token[1];
  var val = context.getToken(name);
  if (val !== undefined) {
    return useExistingVariable(context, token, tokens, dfs);
  } else {
    return defineVariable(context, token, tokens, dfs);
  }
};
