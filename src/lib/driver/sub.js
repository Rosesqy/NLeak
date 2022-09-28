const v8 = require("node:v8")

process.on("message", (msg) => {
  switch (msg.action) {
    case "sayHello":
      process.send({
        action: "sayHello",
        data: {
          hello: "world",
          gotData: data,
        },
      });
      break;
    case "takeSnapShot":
      v8.getHeapSnapshot();
      break;
    default:
      console.log("message action not supported", msg.action);
      break;
  }
});
