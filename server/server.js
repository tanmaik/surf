const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, clientTracking: true });

const connections = new Map();

async function deleteEverything() {
  await prisma.group.deleteMany();
  await prisma.listener.deleteMany();
  await prisma.tab.deleteMany();
  console.log("Deleted everything");
}
deleteEverything();

wss.on("connection", (ws, req) => {
  console.log("Someone connected");

  ws.on("message", async (message) => {
    const data = JSON.parse(message);

    console.log(data);

    if (data.type == "keepalive") {
      ws.send(JSON.stringify({ type: "keepalive", data: "keepalive" }));
      return;
    }

    if (data.type == "test") {
      return;
    }
    if (data.listenerId) {
      data.listenerId = data.listenerId.toString();
      connections.set(data.listenerId, ws);
    }

    let group = null;
    switch (data.type) {
      case "join_group":
        group = await prisma.group.update({
          where: {
            id: data.groupId,
          },
          data: {
            listeners: {
              create: {
                id: data.listenerId,
              },
            },
          },
          include: {
            tabs: true,
          },
        });
        console.log(
          "Someone joined this group and is asking for the initial tabs to open them"
        );
        connections.get(data.listenerId).send(
          JSON.stringify({
            type: "group_joined",
            group,
            listenerId: data.listenerId,
          })
        );
        break;
      case "create_group":
        group = await prisma.group.create({
          data: {
            listeners: {
              create: {
                id: data.listenerId,
              },
            },
            tabs: {
              create: data.tabs.map((tab) => {
                return {
                  url: tab.url,
                };
              }),
            },
          },
          include: {
            listeners: true,
            tabs: true,
          },
        });
        console.log(
          "Broadcasting group to group creator",
          data.listenerId,
          "with group",
          group
        );

        connections.get(data.listenerId).send(
          JSON.stringify({
            type: "group_created",
            group,
            listenerId: data.listenerId,
          })
        );
        break;
      case "leave_group":
        break;
      case "update_tab":
        console.log("Someone updated an existing tab with a new link");
        if (!data.tab.serverId) {
          console.log("No server id");
          return;
        }
        const updatedTab = await prisma.tab.update({
          where: { id: data.tab.serverId },
          data: {
            url: data.tab.url,
          },
          include: {
            group: { include: { listeners: true } },
          },
        });
        for (const listener of updatedTab.group.listeners) {
          console.log("Broadcasting tab update to other listeners");
          if (listener.id !== data.listenerId) {
            console.log("Broadcasting tab update other listener" + listener.id);
            connections.get(listener.id).send(
              JSON.stringify({
                type: "tab_updated_by_other",
                tab: updatedTab,
                listenerId: listener.id,
              })
            );
          }
        }
        break;
      case "add_tab":
        console.log("Someone added a tab");
        group = await prisma.group.findFirst({
          where: {
            listeners: {
              some: {
                id: data.listenerId,
              },
            },
          },
          include: {
            listeners: true,
          },
        });
        const tab = await prisma.tab.create({
          data: {
            url: data.tab.url,
            groupId: group.id,
          },
        });
        console.log("Broadcasting server id back to person who added tab");
        connections.get(data.listenerId).send(
          JSON.stringify({
            type: "tab_added",
            tab,
            clientId: data.clientId,
            listenerId: data.listenerId,
          })
        );
        for (const listener of group.listeners) {
          console.log("Broadcasting added tab to other listeners");
          if (listener.id !== data.listenerId) {
            connections.get(listener.id).send(
              JSON.stringify({
                type: "tab_added_by_other",
                tab,
                listenerId: listener.id,
              })
            );
          }
        }
        break;
      case "remove_tab":
        console.log("Someone removed a tab");
        if (!data.tabId) {
          console.log("No server id");
          return;
        }
        const deletedTab = await prisma.tab.delete({
          where: { id: data.tabId },
          include: {
            group: { include: { listeners: true } },
          },
        });
        for (const listener of deletedTab.group.listeners) {
          console.log("Broadcasting removed tab to other listeners");
          if (listener.id !== data.listenerId) {
            connections.get(listener.id).send(
              JSON.stringify({
                type: "tab_removed_by_other",
                tab: deletedTab,
                listenerId: listener.id,
              })
            );
          }
        }
        break;
      default:
        break;
    }
  });

  ws.on("close", () => {
    console.log("close");
  });

  ws.on("error", console.error);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

app.get("/", (req, res) => {
  res.send("WebSocket server is running");
});
