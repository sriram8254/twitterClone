const express = require("express");
const app = express();
app.use(express.json());
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

let db = null;
const initializeDBAndServer = async (request, response) => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

app.post("/register/", async (request, response) => {
  const { username, password, gender, name } = request.body;
  const getQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await db.get(getQuery);
  if (user === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashPassword = await bcrypt.hash(password, 10);
      const postQuery = `INSERT INTO user (username, password, gender, name) VALUES ('${username}', '${hashPassword}', '${gender}', '${name}');`;
      await db.run(postQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await db.get(getQuery);
  if (user !== undefined) {
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (isPasswordCorrect === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getUserId = `SELECT * FROM user WHERE username = '${username}';`;
  const userDetails = await db.get(getUserId);
  const getFollowingUserIds = `SELECT username, tweet, date_time AS dateTime FROM tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id INNER JOIN user ON follower.following_user_id = user.user_id WHERE follower.follower_user_id = ${userDetails.user_id} ORDER BY dateTime DESC LIMIT 4;`;
  const resultArray = await db.all(getFollowingUserIds);
  response.send(resultArray);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getUserId = `SELECT user_id FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserId);
  const resultQuery = `SELECT name FROM follower INNER JOIN user ON follower.following_user_id = user_id WHERE  follower.follower_user_id = ${dbUser.user_id};`;
  const resultArray = await db.all(resultQuery);
  response.send(resultArray);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getUserId = `SELECT user_id FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserId);
  const resultQuery = `SELECT name FROM follower INNER JOIN user ON follower.follower_user_id = user_id WHERE  follower.following_user_id = ${dbUser.user_id};`;
  const resultArray = await db.all(resultQuery);
  response.send(resultArray);
});

const tweetAccessVerification = async (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request;
  const getUserId = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUserDetails = await db.get(getUserId);
  const getTweetQuery = `SELECT * FROM tweet INNER JOIN follower ON tweet.user_id = following_user_id WHERE tweet_id = ${tweetId} AND follower_user_id = ${dbUserDetails.user_id};`;
  const userDetails = await db.all(getTweetQuery);
  if (userDetails.length === 0) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const resultQuery = `SELECT tweet,
    (SELECT COUNT() FROM like WHERE tweet_id = ${tweetId}) AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = ${tweetId}) AS replies,
    date_time AS dateTime 
    FROM tweet
    WHERE tweet_id = ${tweetId};`;
    const resultArray = await db.get(resultQuery);
    response.send(resultArray);
  }
);

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const resultQuery = `SELECT user.username FROM user INNER JOIN like ON user.user_id = like.user_id WHERE tweet_id = ${tweetId};`;
    const resultArray = await db.all(resultQuery);
    let array = resultArray.map((eachItem) => eachItem.username);
    response.send({ likes: array });
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const resultQuery = `SELECT name, reply FROM user INNER JOIN reply ON user.user_id = reply.user_id WHERE tweet_id = ${tweetId};`;
    const array = await db.all(resultQuery);
    response.send({ replies: array });
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserId = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUserDetails = await db.get(getUserId);
  console.log(dbUserDetails);
  const resultQuery = `SELECT tweet, COUNT(DISTINCT(like_id)) AS likes, COUNT(DISTINCT(reply_id)) AS replies, date_time AS dateTime FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id LEFT JOIN like ON tweet.tweet_id = like.tweet_id WHERE tweet.user_id = ${dbUserDetails.user_id}
  GROUP BY tweet.tweet_id;`;
  const resultArray = await db.all(resultQuery);
  response.send(resultArray);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserId = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUserDetails = await db.get(getUserId);
  const { tweet } = request.body;
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");

  console.log(dateTime);
  const getQuery = `INSERT INTO tweet (tweet, user_id, date_time) VALUES ('${tweet}', ${dbUserDetails.user_id}, '${dateTime}');`;
  await db.run(getQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const getUserId = `SELECT * FROM user WHERE username = '${username}';`;
    const dbUserDetails = await db.get(getUserId);
    const query = `SELECT * FROM tweet WHERE tweet_id = ${tweetId} AND user_id = ${dbUserDetails.user_id};`;
    const tweet = await db.get(query);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId};`;
      await db.run(deleteQuery);
      response.send("Tweet Removed");
    }
  }
);
module.exports = app;
