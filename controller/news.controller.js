import vine, { errors } from "@vinejs/vine";

import { NewsApiTransform } from "../transform/NewsApiTransform.js";
import { newsSchema } from "../validation/news.validation.js";
import {
  generateRandomName,
  imageValidator,
  uploadFileLocally,
} from "../utils/helper.js";
import prisma from "../DB/db.config.js";

export class NewsController {
  static async getNews(req, res) {
    try {
      const user = req.user;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 1;

      // validate the correct page size and limit
      if (page <= 0) {
        page = 1;
      }

      if (limit <= 0 || limit > 100) {
        limit = 10;
      }

      // assign the skip value while fetching the news data
      const skip = (page - 1) * limit;

      // calculate the total_pages from the news_count and limit values
      const newsCount = await prisma.news.count();
      const totalPages = Math.ceil(newsCount / limit);

      const news = await prisma.news.findMany({
        take: limit,
        skip: skip,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });
      const transformNews = news?.map((item) =>
        NewsApiTransform.transform(item)
      );

      // sending the metadata along with news payload
      res.status(200).json({
        status: 200,
        news: transformNews,
        metadata: {
          totalPages,
          current_page: page,
          page_limit: limit,
        },
      });
    } catch (error) {
      return res
        .status(500)
        .json({ status: 500, message: "Something went wrong." });
    }
  }

  static async createNews(req, res) {
    try {
      const user = req.user;
      const body = req.body;

      const validator = vine.compile(newsSchema);
      const payload = await validator.validate(body);

      // check whether we have the image object in req.files
      if (!req.files || Object.keys(req.files).length === 0) {
        return res
          .status(400)
          .json({ status: 400, message: "Image field is required." });
      }

      // get the image object from req.files
      const image = req.files?.image;

      // check the image size and mimetype
      const imageValidationError = imageValidator(image?.size, image.mimetype);

      if (imageValidationError !== null) {
        return res
          .status(400)
          .json({ status: 400, errors: { image: imageValidationError } });
      }

      // generate the random filename and attach it with file extension
      const imageExtension = image.name.split(".")[1];
      const imageName = generateRandomName() + "." + imageExtension;

      // construct the local file path to save the file locally
      const filePath = process.cwd() + "/public/images/" + imageName;
      image.mv(filePath, (error) => {
        if (error) throw error;
      });

      //   add the image and user_id to the payload object
      payload.image = imageName;
      payload.user_id = user.id;

      // save the new news object in the stored News table
      const news = await prisma.news.create({
        data: payload,
      });

      res.status(201).json({
        status: 201,
        message: "News entry created successfully.",
        news,
      });
    } catch (error) {
      console.log({ error });
      if (error instanceof errors.E_VALIDATION_ERROR) {
        res.status(400).json({ errors: error.messages });
      } else {
        res.status(500).json({
          status: 500,
          message: "Something went wrong. Please try again.",
        });
      }
    }
  }

  static async getNewsById(req, res) {
    try {
      const user = req.user;
      const id = Number(req.params.id);

      const news = await prisma.news.findUnique({
        where: {
          id,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      res
        .status(200)
        .json({ status: 200, news: NewsApiTransform.transform(news) });
    } catch (error) {
      console.log({ error });
      return res
        .status(500)
        .json({ status: 500, message: "Something went wrong." });
    }
  }

  static async updateNews(req, res) {
    try {
      const user = req.user;
      const id = req.params.id;
      const body = req.body;

      // fetch the news using news_id
      const news = await prisma.news.findUnique({
        where: {
          id: Number(id),
        },
      });

      // check if the user is same as the one who post this news
      if (user.id !== news.user_id) {
        return res
          .status(400)
          .json({ status: 400, message: "User is unauthorized." });
      }

      // validate the request body
      const validator = vine.compile(newsSchema);
      const payload = validator.validate(body);

      const image = req?.files?.image;

      if (image) {
        // check the image size and mimetype
        const imageValidationError = imageValidator(
          image?.size,
          image.mimetype
        );

        if (imageValidationError !== null) {
          return res
            .status(400)
            .json({ status: 400, errors: { image: imageValidationError } });
        }

        // create the local file path using image and saving the file locally
        const imageName = uploadFileLocally(image);

        payload.image = imageName;

        // remove the previously updloaded news image
        removeImage(news.image);
      }

      console.log({ payload });

      await prisma.news.update({
        data: payload,
        where: {
          id: Number(id),
        },
      });
    } catch (error) {
      if (error instanceof errors.E_VALIDATION_ERROR) {
        res.status(400).json({ errors: error.messages });
      } else {
        res.status(500).json({
          status: 500,
          message: "Something went wrong. Please try again.",
        });
      }
    }
  }
}
