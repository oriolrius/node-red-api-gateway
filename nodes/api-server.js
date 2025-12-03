module.exports = function(RED) {
    function ApiServerNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.on("input", function(msg, send, done) {
            // Node-RED 1.0+ compatibility
            send = send || function() { node.send.apply(node, arguments); };

            try {
                if (typeof msg.payload === "string") {
                    msg.payload = msg.payload.toLowerCase();
                }
                send(msg);
                if (done) {
                    done();
                }
            } catch (err) {
                if (done) {
                    done(err);
                } else {
                    node.error(err, msg);
                }
            }
        });

        node.on("close", function(removed, done) {
            // Cleanup resources if needed
            if (done) {
                done();
            }
        });
    }

    RED.nodes.registerType("api-server", ApiServerNode);
};
