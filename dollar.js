var Dollar = (function() {
    var lower_bound = "a".charCodeAt(0);
    var upper_bound = "Z".charCodeAt(0);
    
    var is_valid = function(s) {
        var i = s.charCodeAt(0);
        if ((i >= lower_bound) && (i <= upper_bound)) {
            return true;
        } else {
            return false;
        }
    };
    
    var extract = function(s, starts, modifiers) {
        var start_chars = starts || ["$"];
        var mod_chars = modifiers || ["|"];
        
        var accum = [];
        var index = 0;
        var in_var = false;
        var buffer = [];

        for(var i=0; i < s.length; i++) {
            var char = s[i];
            if (in_var) {
                if (is_valid(char)) {
                    buffer.push(char);
                } else {
                    in_var = false;
                    accum.push(buffer.join(''));
                    buffer = [];
                }
            } else {
                if (start_chars.indexOf(char) != -1) {
                    in_var = true;
                }
            }
        }

        if (buffer.length) {
            accum.push(buffer);
        }

        return accum;
    };
    var render  = function() {};
})();
